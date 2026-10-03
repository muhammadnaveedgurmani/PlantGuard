import { Hono } from 'hono'
import type { Bindings } from '../types'
import { getOrCreateSessionId } from '../lib/session'
import { chatWithAssistant, type ChatMessage, type ToolCall } from '../lib/ai'
import { checkRateLimit, getClientIp, rateLimitResponseBody, RATE_LIMITS } from '../lib/rateLimit'
import { detectLocationFromIp, geocodeCity, getRealWeatherForecast } from '../lib/weather'
import { lookupKnowledge } from '../lib/knowledgeBase'

const chatbot = new Hono<{ Bindings: Bindings }>()

const MAX_HISTORY = 20 // messages of context sent to the model
const MAX_TOOL_HOPS = 3 // hard cap: never let the model loop tool calls forever

// PHASE 11: Strict, validated execution of each scoped tool. Every tool is
// read-only, arguments are checked before use, and failures return a safe
// error string back to the model (never throw into the request).
async function executeTool(
  name: string,
  argsRaw: string,
  ctx: { env: Bindings; sessionId: string }
): Promise<{ result: string; observability: { tool: string; ok: boolean } }> {
  let args: any = {}
  try {
    args = argsRaw ? JSON.parse(argsRaw) : {}
  } catch {
    return { result: JSON.stringify({ error: 'Invalid tool arguments (not valid JSON).' }), observability: { tool: name, ok: false } }
  }

  try {
    if (name === 'get_weather') {
      const city = typeof args.city === 'string' ? args.city.trim().slice(0, 100) : ''
      if (!city) return { result: JSON.stringify({ error: 'city is required' }), observability: { tool: name, ok: false } }
      const loc = await geocodeCity(city)
      if (!loc) return { result: JSON.stringify({ error: `Could not find location "${city}"` }), observability: { tool: name, ok: false } }
      const forecast = await getRealWeatherForecast(loc)
      if (!forecast) return { result: JSON.stringify({ error: 'Weather service unavailable' }), observability: { tool: name, ok: false } }
      return {
        result: JSON.stringify({
          city: forecast.city,
          country: forecast.country,
          current: forecast.current,
          next_day: forecast.daily[0] || null
        }),
        observability: { tool: name, ok: true }
      }
    }

    if (name === 'get_diagnosis_history') {
      const limit = Math.min(10, Math.max(1, typeof args.limit === 'number' ? Math.floor(args.limit) : 5))
      const { results } = await ctx.env.DB.prepare(
        `SELECT plant_name, disease_name, is_healthy, confidence, severity, created_at
         FROM diagnoses WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
      )
        .bind(ctx.sessionId, limit)
        .all()
      return { result: JSON.stringify({ records: results }), observability: { tool: name, ok: true } }
    }

    if (name === 'get_disease_knowledge') {
      const diseaseName = typeof args.disease_name === 'string' ? args.disease_name.trim().slice(0, 200) : ''
      if (!diseaseName) return { result: JSON.stringify({ error: 'disease_name is required' }), observability: { tool: name, ok: false } }
      const record = await lookupKnowledge(ctx.env.DB, diseaseName)
      if (!record) {
        return {
          result: JSON.stringify({ found: false, note: 'No verified PlantGuard knowledge record for this disease; answer from general knowledge and say so.' }),
          observability: { tool: name, ok: true }
        }
      }
      return { result: JSON.stringify({ found: true, ...record, source: 'Verified PlantGuard Knowledge' }), observability: { tool: name, ok: true } }
    }

    return { result: JSON.stringify({ error: `Unknown tool: ${name}` }), observability: { tool: name, ok: false } }
  } catch (e: any) {
    return { result: JSON.stringify({ error: `Tool execution failed: ${e?.message || e}` }), observability: { tool: name, ok: false } }
  }
}

// POST /api/chat/send  { message: string, diagnosis_context?: { diagnosis_id?: number } }
chatbot.post('/send', async (c) => {
  const sessionId = getOrCreateSessionId(c)

  // PHASE 1: rate limiting (keyed on client IP + session cookie)
  const rl = checkRateLimit(sessionId, getClientIp(c), RATE_LIMITS.chat)
  if (!rl.allowed) {
    return c.json(rateLimitResponseBody(rl, 'chat'), 429)
  }

  const body = await c.req.json<{ message: string; diagnosis_id?: number }>()
  const message = body.message

  if (!message || !message.trim()) {
    return c.json({ error: 'Message cannot be empty.' }, 400)
  }
  if (message.length > 2000) {
    return c.json({ error: 'Message is too long (max 2000 characters).' }, 400)
  }

  // PHASE 10: Diagnosis-aware chat. If the client passes a diagnosis_id
  // ("Ask AI About This Result"), fetch a concise, safe summary of that
  // diagnosis and inject it as hidden context -- the user never has to
  // retype their result, and we never expose raw chain-of-thought, just
  // structured facts already computed deterministically.
  let contextPrefix = ''
  if (body.diagnosis_id) {
    const row = await c.env.DB.prepare(`SELECT * FROM diagnoses WHERE id = ? AND session_id = ?`)
      .bind(body.diagnosis_id, sessionId)
      .first()
    if (row) {
      const r = row as any
      contextPrefix =
        `[Context: The user is asking about a recent PlantGuard diagnosis. ` +
        `Plant: ${r.plant_name}. Result: ${r.is_healthy ? 'Healthy' : r.disease_name}. ` +
        `Confidence: ${r.confidence}% (${r.confidence_level || 'n/a'}). Severity: ${r.severity}. ` +
        `Use this as background; do not ask the user to re-describe it.]\n\n`
    }
  }

  const finalUserMessage = contextPrefix + message

  // Save user message (store the raw message the user typed, not the injected context)
  await c.env.DB.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)`)
    .bind(sessionId, message)
    .run()

  // Load recent history for context
  const { results } = await c.env.DB.prepare(
    `SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
  )
    .bind(sessionId, MAX_HISTORY)
    .all()

  const history: ChatMessage[] = (results as any[]).reverse().map((r) => ({ role: r.role, content: r.content }))
  // Replace the last (just-inserted) user message with the context-enriched version for THIS request only.
  if (history.length > 0 && history[history.length - 1].role === 'user') {
    history[history.length - 1] = { role: 'user', content: finalUserMessage }
  }

  let reply: string
  let toolsUsed: string[] = []
  try {
    let outcome = await chatWithAssistant(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, history, c.env.DB, sessionId, true)
    let hops = 0
    const workingMessages: ChatMessage[] = [...history]

    while (outcome.toolCalls && outcome.toolCalls.length > 0 && hops < MAX_TOOL_HOPS) {
      hops++
      workingMessages.push({ role: 'assistant', content: outcome.content, tool_calls: outcome.toolCalls })
      for (const tc of outcome.toolCalls as ToolCall[]) {
        const { result, observability } = await executeTool(tc.function.name, tc.function.arguments, {
          env: c.env,
          sessionId
        })
        toolsUsed.push(`${observability.tool}${observability.ok ? '' : ':error'}`)
        workingMessages.push({ role: 'tool', content: result, tool_call_id: tc.id, name: tc.function.name })
      }
      outcome = await chatWithAssistant(c.env.OPENAI_API_KEY, c.env.OPENAI_BASE_URL, workingMessages, c.env.DB, sessionId, true)
    }

    reply = outcome.content || 'Sorry, I could not generate a response. Please try rephrasing your question.'
  } catch (e: any) {
    return c.json({ error: `AI chatbot failed: ${e.message || e}` }, 502)
  }

  const insertRes = await c.env.DB.prepare(`INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)`)
    .bind(sessionId, reply)
    .run()
  const messageId = (insertRes.meta as any)?.last_row_id ?? null

  return c.json({ reply, message_id: messageId, tools_used: toolsUsed })
})

// GET /api/chat/history
chatbot.get('/history', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const { results } = await c.env.DB.prepare(
    `SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`
  )
    .bind(sessionId)
    .all()
  return c.json({ messages: results })
})

// DELETE /api/chat/history -- clear conversation
chatbot.delete('/history', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  await c.env.DB.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).bind(sessionId).run()
  return c.json({ success: true })
})

// POST /api/chat/:id/feedback  { feedback: 'helpful' | 'not_helpful' }  (Phase 3)
chatbot.post('/:id/feedback', async (c) => {
  const sessionId = getOrCreateSessionId(c)
  const id = c.req.param('id')
  const { feedback } = await c.req.json<{ feedback: string }>()
  if (feedback !== 'helpful' && feedback !== 'not_helpful') {
    return c.json({ error: 'feedback must be "helpful" or "not_helpful"' }, 400)
  }

  const owns = await c.env.DB.prepare(`SELECT id FROM chat_messages WHERE id = ? AND session_id = ? AND role = 'assistant'`)
    .bind(id, sessionId)
    .first()
  if (!owns) return c.json({ error: 'Message not found.' }, 404)

  await c.env.DB.prepare(
    `INSERT INTO ai_feedback (request_type, target_type, target_id, session_id, feedback)
     VALUES ('chat', 'chat_message', ?, ?, ?)
     ON CONFLICT(target_type, target_id, session_id) DO UPDATE SET feedback = excluded.feedback, created_at = CURRENT_TIMESTAMP`
  )
    .bind(id, sessionId, feedback)
    .run()

  return c.json({ success: true })
})

export default chatbot
