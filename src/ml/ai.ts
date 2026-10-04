// Thin wrapper around the OpenAI-compatible Chat Completions API used for:
// 1) Vision-based plant disease diagnosis from an uploaded leaf photo
// 2) The AI Plant Care chatbot (now with scoped tool-calling, Phase 11)
// 3) On-demand cultivation tips / disease library lookups (cached in D1)
//
// Uses plain fetch() instead of the `openai` npm package to keep the
// Worker bundle small and avoid Node-specific dependencies.
//
// AI Observability: every call through callChatCompletions() is logged
// (best-effort, never blocking/breaking the actual AI request) via
// logAiCall() in ./aiObservability. This is the single shared place all
// AI calls flow through, so no route needs to duplicate logging logic.
//
// Model Fallback (Phase 7): if the primary model call fails (network error,
// non-2xx, or empty content), one retry is attempted against a configured
// fallback model before giving up. This never doubles cost for a normal
// successful call -- the fallback path only runs when the primary attempt
// has already failed.

import { logAiCall, type AiRequestType } from './aiObservability'
import { DEFAULT_AI_FALLBACK_MODEL, DEFAULT_AI_MODEL } from '../config'

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | Array<
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  > | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export type ToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type ToolSchema = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

// Configurable model names (Phase 7: "do not hard-code unnecessary
// provider-specific assumptions"). Primary stays the preferred model; the
// fallback is only used after the primary attempt fails.
// Overridable per-deployment via AI_MODEL / AI_FALLBACK_MODEL env vars
// (see configureAiModels, called from src/index.tsx middleware).
// Overridable per-deployment via AI_MODEL / AI_FALLBACK_MODEL env vars
// (see configureAiModels, called from the aiModelConfig middleware).
// Defaults live in src/config.ts.
const aiModels = { primary: DEFAULT_AI_MODEL, fallback: DEFAULT_AI_FALLBACK_MODEL }
export function configureAiModels(primary?: string, fallback?: string) {
  if (primary && primary.trim()) aiModels.primary = primary.trim()
  if (fallback && fallback.trim()) aiModels.fallback = fallback.trim()
}

// Optional observability context passed by callers. `db` is intentionally
// optional -- if it's not provided (or the insert fails), the AI call still
// proceeds normally and just isn't logged.
type ObservabilityContext = {
  db?: D1Database
  requestType: AiRequestType
  promptVersion: string
  sessionId?: string | null
}

type RawCompletionResult = {
  content: string | null
  toolCalls: ToolCall[] | null
  modelUsed: string
  fallbackUsed: boolean
}

async function requestOnce(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  jsonMode: boolean,
  tools: ToolSchema[] | undefined
): Promise<{ ok: true; content: string | null; toolCalls: ToolCall[] | null; usage: any } | { ok: false; errorType: string; errorMessage: string }> {
  let res: Response
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...(tools ? { tools, tool_choice: 'auto' } : {})
      }),
      signal: AbortSignal.timeout(45000)
    })
  } catch (e: any) {
    return { ok: false, errorType: 'network_error', errorMessage: e?.message || String(e) }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    return { ok: false, errorType: `http_${res.status}`, errorMessage: errText.slice(0, 300) }
  }

  const data = await res.json<any>()
  const msg = data?.choices?.[0]?.message
  const content = msg?.content ?? null
  const toolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0 ? msg.tool_calls : null
  const usage = data?.usage || {}

  if (!content && !toolCalls) {
    return { ok: false, errorType: 'empty_content', errorMessage: 'AI API returned no content and no tool calls' }
  }

  return { ok: true, content, toolCalls, usage }
}

/**
 * Core call path shared by every AI feature. Handles: primary model call,
 * single fallback-model retry on failure, and best-effort observability
 * logging (latency, success/failure, tokens, fallback usage, tool-call
 * usage). Never throws for logging failures; only throws if BOTH the
 * primary and fallback attempts fail.
 */
async function callChatCompletionsRaw(
  apiKey: string,
  baseUrl: string,
  messages: ChatMessage[],
  jsonMode: boolean,
  obs: ObservabilityContext,
  tools?: ToolSchema[]
): Promise<RawCompletionResult> {
  const startedAt = Date.now()

  const logResult = (args: {
    success: boolean
    modelUsed: string
    fallbackUsed: boolean
    toolCallsUsed: boolean
    errorType?: string
    errorMessage?: string
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }) => {
    if (!obs.db) return Promise.resolve()
    return logAiCall({
      db: obs.db,
      requestType: obs.requestType,
      model: args.modelUsed,
      promptVersion: obs.promptVersion,
      sessionId: obs.sessionId ?? null,
      latencyMs: Date.now() - startedAt,
      fallbackUsed: args.fallbackUsed,
      fallbackModel: args.fallbackUsed ? aiModels.fallback : undefined,
      toolCallsUsed: args.toolCallsUsed,
      success: args.success,
      errorType: args.errorType,
      errorMessage: args.errorMessage,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      totalTokens: args.totalTokens
    })
  }

  // Attempt 1: primary model
  const primary = await requestOnce(apiKey, baseUrl, aiModels.primary, messages, jsonMode, tools)
  if (primary.ok) {
    const toolCallsUsed = !!primary.toolCalls
    await logResult({
      success: true,
      modelUsed: aiModels.primary,
      fallbackUsed: false,
      toolCallsUsed,
      promptTokens: primary.usage.prompt_tokens,
      completionTokens: primary.usage.completion_tokens,
      totalTokens: primary.usage.total_tokens
    })
    return { content: primary.content, toolCalls: primary.toolCalls, modelUsed: aiModels.primary, fallbackUsed: false }
  }

  console.error(`[ai-fallback] primary model "${aiModels.primary}" failed (${primary.errorType}), attempting fallback "${aiModels.fallback}"`)

  // Attempt 2: fallback model (single retry only -- Phase 7: "do not
  // endlessly retry", "avoid doubling cost unnecessarily")
  const fallback = await requestOnce(apiKey, baseUrl, aiModels.fallback, messages, jsonMode, tools)
  if (fallback.ok) {
    const toolCallsUsed = !!fallback.toolCalls
    await logResult({
      success: true,
      modelUsed: aiModels.fallback,
      fallbackUsed: true,
      toolCallsUsed,
      promptTokens: fallback.usage.prompt_tokens,
      completionTokens: fallback.usage.completion_tokens,
      totalTokens: fallback.usage.total_tokens
    })
    return { content: fallback.content, toolCalls: fallback.toolCalls, modelUsed: aiModels.fallback, fallbackUsed: true }
  }

  // Both failed -- log the final (fallback) failure and throw.
  await logResult({
    success: false,
    modelUsed: aiModels.fallback,
    fallbackUsed: true,
    toolCallsUsed: false,
    errorType: fallback.errorType,
    errorMessage: `primary:${primary.errorType}; fallback:${fallback.errorType}: ${fallback.errorMessage}`
  })
  throw new Error(`AI request failed on both primary and fallback models: ${fallback.errorMessage}`)
}

/** Back-compat helper for callers that only need the text content (no tool calls). */
async function callChatCompletions(
  apiKey: string,
  baseUrl: string,
  messages: ChatMessage[],
  jsonMode: boolean,
  obs: ObservabilityContext
): Promise<string> {
  const result = await callChatCompletionsRaw(apiKey, baseUrl, messages, jsonMode, obs)
  if (!result.content) throw new Error('AI API returned no content')
  return result.content
}

export type DiagnosisResult = {
  is_leaf: boolean
  is_healthy: boolean
  plant_name: string
  disease_name: string
  confidence: number // 0-100, AI-ESTIMATED -- not a calibrated statistical probability
  confidence_level: 'high' | 'medium' | 'low'
  severity: 'None' | 'Low' | 'Moderate' | 'High' | 'Critical'
  symptoms: string[]
  spread: string[]
  treatment: string[]
  prevention: string[]
  notes: string
  secondary_possibilities: { disease_name: string; confidence: number }[]
  model_used: string
  fallback_used: boolean
}

// PHASE 8: Prompt versioning -- bump this string whenever the diagnosis
// system prompt changes materially, so AI observability logs can answer
// "which prompt produced this result?" without storing the prompt itself.
export const DIAGNOSIS_PROMPT_VERSION = 'diagnosis-v2'

const DIAGNOSIS_SYSTEM_PROMPT = `You are PlantGuard AI, an expert plant pathologist and agronomist.
You will be shown a photo. Perform these steps:

1. First determine if the photo actually shows a plant leaf (or plant part). If it does NOT show a plant/leaf, set "is_leaf" to false and leave other fields as best-guess defaults.
2. If it is a leaf, identify the plant species/crop if possible.
3. Determine if the plant looks healthy or diseased/pest-damaged.
4. If diseased, identify the most likely disease or issue, estimate your confidence (0-100), and assess severity (None, Low, Moderate, High, Critical).
5. If more than one disease is plausible from the visual evidence, list up to 2 secondary possibilities with their own approximate confidence in "secondary_possibilities". If there is truly only one clear possibility, leave it as an empty array.
6. Provide practical, actionable information: symptoms visible, how the disease spreads, treatment steps, and prevention tips. Each of these should be an array of short, concrete bullet-point strings (3-6 items each).
7. Be honest about uncertainty. Your "confidence" score is YOUR OWN estimate of how sure you are from the image alone -- it is NOT a scientifically calibrated probability. If the image is ambiguous, blurry, partially obscured, or the symptoms could match multiple issues, lower your confidence and say so plainly in "notes". Never present false certainty.

Respond ONLY with a single JSON object matching exactly this shape, no markdown, no extra text:
{
  "is_leaf": boolean,
  "is_healthy": boolean,
  "plant_name": string,
  "disease_name": string,
  "confidence": number,
  "severity": "None" | "Low" | "Moderate" | "High" | "Critical",
  "symptoms": string[],
  "spread": string[],
  "treatment": string[],
  "prevention": string[],
  "secondary_possibilities": [{"disease_name": string, "confidence": number}],
  "notes": string
}`

export async function diagnoseLeafImage(
  apiKey: string,
  baseUrl: string,
  imageDataUrl: string,
  db?: D1Database,
  sessionId?: string | null
): Promise<{ raw: any; modelUsed: string; fallbackUsed: boolean }> {
  const result = await callChatCompletionsRaw(
    apiKey,
    baseUrl,
    [
      { role: 'system', content: DIAGNOSIS_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this plant leaf photo and return the JSON diagnosis.' },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      }
    ],
    true,
    { db, requestType: 'diagnosis', promptVersion: DIAGNOSIS_PROMPT_VERSION, sessionId }
  )

  if (!result.content) throw new Error('AI diagnosis returned no content')
  return { raw: JSON.parse(result.content), modelUsed: result.modelUsed, fallbackUsed: result.fallbackUsed }
}

/**
 * Lightweight leaf gate for the on-device CNN path.
 * The CNN is a closed-set classifier (38 plant classes) — it cannot say
 * "not a plant", so a food photo gets misdiagnosed with high confidence.
 * This minimal vision call answers only "is this a plant leaf?" before
 * any CNN result is accepted. Cheap: tiny prompt, tiny JSON reply.
 */
export async function validateIsLeaf(
  apiKey: string,
  baseUrl: string,
  imageDataUrl: string,
  db?: D1Database,
  sessionId?: string | null
): Promise<boolean> {
  const result = await callChatCompletionsRaw(
    apiKey,
    baseUrl,
    [
      { role: 'system', content: 'You are an image filter. Reply with ONLY valid JSON: {"is_leaf": boolean}.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Does this photo show a plant leaf or plant part? Reply ONLY {"is_leaf": true} or {"is_leaf": false}.' },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      }
    ],
    true,
    { db, requestType: 'leaf_gate', promptVersion: 'v1', sessionId }
  )
  if (!result.content) throw new Error('Leaf gate returned no content')
  try {
    return JSON.parse(result.content).is_leaf === true
  } catch {
    // Unparseable gate response: fail closed (treat as not a leaf).
    return false
  }
}

export const CHATBOT_PROMPT_VERSION = 'chatbot-v2'

const CHATBOT_SYSTEM_PROMPT = `You are PlantGuard AI Assistant, a friendly and knowledgeable virtual agronomist and plant-care expert embedded in the PlantGuard app.
Help farmers and plant lovers with questions about plant diseases, pest control, cultivation practices, soil, watering, fertilizers, and general gardening.
Keep answers practical, concise, and easy to understand. Use simple language. Use short paragraphs or bullet points when listing steps.
If the user writes in Urdu/Roman Urdu, you may respond in the same style to be helpful. If a question is unrelated to plants/farming/gardening, politely redirect back to plant care topics.

You have access to tools: get_weather, get_diagnosis_history, and get_disease_knowledge. Use a tool ONLY when the user's question genuinely needs that specific real data (e.g. current weather, their past diagnoses, or verified disease facts) to give a correct, useful answer. Do not call a tool "just in case" -- if you already know enough to answer well, answer directly. When you do use tool results, weave them naturally into your answer; do not describe your internal reasoning process or mention the tools by name.

If the user references a specific plant diagnosis result (plant, disease, severity, confidence) as context for their question, treat that information as already known and relevant -- do not ask the user to repeat it.`

// PHASE 11: Strict, minimal tool schemas for the scoped assistant. Only
// three tools, each read-only and validated before execution (see
// chatbot.ts for argument validation + safe execution).
export const CHAT_TOOLS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description:
        "Get the current weather conditions and short forecast for a city, to answer questions like 'should I spray today' or 'is it going to rain'.",
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name, e.g. "Lahore" or "Multan"' }
        },
        required: ['city']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_diagnosis_history',
      description:
        "Get the current user's recent plant diagnosis history (plant, disease, confidence, severity, date) from this session, to answer questions about 'my plant' or 'my recent diagnosis'.",
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max number of recent records to return (default 5, max 10)' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_disease_knowledge',
      description:
        'Look up verified PlantGuard knowledge (symptoms, causes, treatment, prevention) for a specific plant disease by name.',
      parameters: {
        type: 'object',
        properties: {
          disease_name: { type: 'string', description: 'Disease name, e.g. "Tomato Early Blight"' }
        },
        required: ['disease_name']
      }
    }
  }
]

export type ChatCompletionOutcome = {
  content: string | null
  toolCalls: ToolCall[] | null
  modelUsed: string
  fallbackUsed: boolean
}

/**
 * One turn of the tool-calling assistant. Callers (chatbot.ts) are
 * responsible for executing any returned tool_calls, appending the tool
 * results as 'tool' role messages, and calling this again for the final
 * natural-language reply (standard OpenAI function-calling loop).
 */
export async function chatWithAssistant(
  apiKey: string,
  baseUrl: string,
  messages: ChatMessage[],
  db?: D1Database,
  sessionId?: string | null,
  useTools = true
): Promise<ChatCompletionOutcome> {
  const full: ChatMessage[] = [{ role: 'system', content: CHATBOT_SYSTEM_PROMPT }, ...messages]
  const result = await callChatCompletionsRaw(
    apiKey,
    baseUrl,
    full,
    false,
    { db, requestType: 'chat', promptVersion: CHATBOT_PROMPT_VERSION, sessionId },
    useTools ? CHAT_TOOLS : undefined
  )
  return result
}

export type CultivationGuide = {
  watering: string
  sunlight: string
  temperature: string
  soil: string
  fertilizer: string
  spacing: string
  extra_tips: string[]
}

export const CULTIVATION_PROMPT_VERSION = 'cultivation-v1'

export async function generateCultivationGuide(
  apiKey: string,
  baseUrl: string,
  plantName: string,
  db?: D1Database,
  sessionId?: string | null
): Promise<CultivationGuide> {
  const raw = await callChatCompletions(
    apiKey,
    baseUrl,
    [
      {
        role: 'system',
        content: `You are an expert agronomist. Provide a concise cultivation guide for the given plant/crop.
Respond ONLY with a JSON object of this exact shape, no markdown:
{
  "watering": string,
  "sunlight": string,
  "temperature": string,
  "soil": string,
  "fertilizer": string,
  "spacing": string,
  "extra_tips": string[]
}
Keep each string field to 1-2 short sentences. extra_tips should have 3-5 short bullet items.`
      },
      { role: 'user', content: `Plant/crop: ${plantName}` }
    ],
    true,
    { db, requestType: 'library_cultivation', promptVersion: CULTIVATION_PROMPT_VERSION, sessionId }
  )
  const parsed = JSON.parse(raw)
  return {
    watering: parsed.watering || '',
    sunlight: parsed.sunlight || '',
    temperature: parsed.temperature || '',
    soil: parsed.soil || '',
    fertilizer: parsed.fertilizer || '',
    spacing: parsed.spacing || '',
    extra_tips: Array.isArray(parsed.extra_tips) ? parsed.extra_tips : []
  }
}

export type DiseaseInfo = {
  plant_name: string
  symptoms: string[]
  spread: string[]
  treatment: string[]
  prevention: string[]
}

export const DISEASE_INFO_PROMPT_VERSION = 'disease-info-v1'

export async function generateDiseaseInfo(
  apiKey: string,
  baseUrl: string,
  diseaseName: string,
  db?: D1Database,
  sessionId?: string | null
): Promise<DiseaseInfo> {
  const raw = await callChatCompletions(
    apiKey,
    baseUrl,
    [
      {
        role: 'system',
        content: `You are an expert plant pathologist. Provide detailed information about the given plant disease.
Respond ONLY with a JSON object of this exact shape, no markdown:
{
  "plant_name": string,
  "symptoms": string[],
  "spread": string[],
  "treatment": string[],
  "prevention": string[]
}
Each array should have 3-6 short, concrete bullet-point strings.`
      },
      { role: 'user', content: `Disease: ${diseaseName}` }
    ],
    true,
    { db, requestType: 'library_disease', promptVersion: DISEASE_INFO_PROMPT_VERSION, sessionId }
  )
  const parsed = JSON.parse(raw)
  return {
    plant_name: parsed.plant_name || '',
    symptoms: Array.isArray(parsed.symptoms) ? parsed.symptoms : [],
    spread: Array.isArray(parsed.spread) ? parsed.spread : [],
    treatment: Array.isArray(parsed.treatment) ? parsed.treatment : [],
    prevention: Array.isArray(parsed.prevention) ? parsed.prevention : []
  }
}
