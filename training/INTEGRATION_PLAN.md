# PlantGuard CNN — Integration Plan

Goal: make the trained MobileNetV2 the **primary** diagnosis engine, running
**in the user's browser** via TensorFlow.js. The vision-LLM API becomes the
**fallback** for low-confidence predictions. No existing API shapes break;
responses only gain fields.

## 1. Where the model files live

Upload `export/tfjs/` (model.json + weight shards, ~13 MB float32 /
~3–7 MB with float16 quantization) to one of:

- **Option A (recommended): R2.** New prefix in the existing `plantguard-images`
  bucket, e.g. `models/plantguard-cnn/v1/`, served through a Worker route
  (`GET /models/*`) with long cache headers. Same R2 binding (`IMAGES`) the
  app already uses — no new infrastructure.
- **Option B: `public/static/models/`** bundled into the Pages deploy.
  Zero infra, same-origin (no CORS), but every model update = full redeploy.

Serve `labels.json` next to `model.json`. Version the prefix (`v1/`) so a
future retrain never breaks cached clients.

## 2. New server pieces (`src/`)

### `src/ml/cnnLabels.ts` (new)
Maps each of the 38 PlantVillage class names to the app's diagnosis shape:

```ts
export type CnnClassInfo = { plant: string; disease: string; healthy: boolean }
export const CNN_CLASSES: string[] = [ /* from labels.json, index-aligned */ ]
export const CNN_CLASS_INFO: Record<string, CnnClassInfo> = {
  "Tomato___Early_blight": { plant: "Tomato", disease: "Early blight", healthy: false },
  "Tomato___healthy":      { plant: "Tomato", disease: "Healthy",       healthy: true  },
  // ... all 38, generated from labels.json
}
export function cnnLabelToDiagnosis(label: string, confidence: number) { ... }
```

The returned object matches `validateDiagnosisRaw`'s expected fields
(`plant_name`, `disease_name`, `is_healthy`, `confidence`, plus null-safe
defaults for `severity`/`symptoms`/`treatment`/`prevention`), so the **existing
guardrail validation runs unchanged** on CNN results.

### `src/routes/diagnosis.ts` (edit)
1. **New endpoint** `GET /api/diagnosis/cnn-config` → no auth needed:
   ```json
   { "enabled": true, "modelUrl": "/models/plantguard-cnn/v1/model.json",
     "labelsUrl": "/models/plantguard-cnn/v1/labels.json",
     "threshold": 0.70, "version": "v1" }
   ```
   Threshold stays server-controlled → tunable without redeploying the frontend.
2. **`POST /api/diagnosis/analyze`** accepts two new *optional* multipart fields:
   `cnn_prediction` (class label string) and `cnn_confidence` (0–1 float).
   Server logic after the image-quality pre-check:
   - If `cnn_confidence >= threshold` **and** label is a known class →
     **skip the vision-LLM call entirely**, build the result via
     `cnnLabelToDiagnosis()`, run the same `validateDiagnosisRaw` guardrail,
     same R2 store, same D1 insert, respond with the existing shape **plus**
     `engine: "cnn"`, `model_used: "plantguard-cnn-v1"`, `fallback_used: false`.
   - Else → existing vision-LLM path unchanged, respond with `engine: "llm"`.
   - If the CNN fields are absent (old clients), behavior is byte-identical to today.
3. **Migration `0005_engine.sql`**: `ALTER TABLE diagnoses ADD COLUMN engine TEXT NOT NULL DEFAULT 'llm';`
   include `engine` in the INSERT and in history responses.

### Rate limiting
Unchanged. The CNN path still passes `checkRateLimit` — free inference must
not become an unlimited scraping vector.

## 3. New client pieces (`public/static/js/`)

### `public/static/js/cnn/cnnClient.js` (new)
- Lazy-loads `@tensorflow/tfjs` from CDN on first use (not on page load —
  keeps the landing page light).
- `loadModel(modelUrl, labelsUrl)` — cached in memory + IndexedDB
  (`tf.io` IndexedDB handler) so repeat visits work offline-ish.
- `predict(imageElement)` — draws the uploaded photo to an offscreen canvas,
  resizes to **224×224**, converts to float32, applies **MobileNetV2
  preprocessing (`x/127.5 - 1`)**, runs inference, returns
  `{ label, confidence, top3 }`.

### `public/static/js/pages/diagnosis.js` (edit)
Current flow uploads the file straight to `/api/diagnosis/analyze`.
New flow:
1. Fetch `/api/diagnosis/cnn-config` once per session.
2. On image select: run `cnnClient.predict()` locally, show an instant
   "on-device result" state with the top-1 label + confidence bar.
3. If `confidence >= threshold`: POST the image **plus**
   `cnn_prediction`/`cnn_confidence` → server confirms without an LLM call.
   Show a small "Diagnosed on-device" badge.
4. If below threshold: POST as today (LLM fallback), show
   "Low on-device confidence — verifying with cloud AI…" so the fallback
   feels intentional, not broken.

### `public/static/js/components/diagnosisView.js` (edit, minor)
Render the `engine` badge (`On-device CNN` vs `Cloud AI`) and keep every
other field identical — history, report, and library pages need no changes.

## 4. Confidence threshold policy

- Default **0.70**, served from `/api/diagnosis/cnn-config`.
- Below threshold → vision-LLM fallback (costs money, but preserves accuracy
  on ambiguous/field photos — published field accuracy for PlantVillage
  models is ~80%, so the fallback is load-bearing, not decorative).
- Log both engines in D1 (`engine` column) → the existing eval harness can
  later benchmark CNN-vs-LLM agreement per class.

## 5. What does NOT change

- Request/response JSON shapes (only additive `engine` field).
- Image-quality pre-check (runs before either engine).
- Guardrail validation (`validateDiagnosisRaw`).
- R2 image storage, D1 history, rate limiting, session handling.
- The chatbot, community, weather, library, report routes.

## 6. Rollout order

1. Train on Colab → download `plantguard_cnn_artifacts.zip`.
2. Upload `tfjs/` + `labels.json` to R2 `models/plantguard-cnn/v1/`.
3. Add `src/ml/cnnLabels.ts` (generate the 38-entry map from `labels.json`).
4. Migration `0005_engine.sql` + `diagnosis.ts` edits (config endpoint + CNN branch).
5. Frontend: `cnn/cnnClient.js` + `diagnosis.js` flow edit + badge in `diagnosisView.js`.
6. Deploy, then monitor the `engine` split in D1; tune `threshold` if the
   CNN's real-world agreement with the LLM looks weak on any class
   (evaluate.py's "worst 5 classes by F1" is the watchlist).
