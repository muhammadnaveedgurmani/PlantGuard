import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import type { Bindings } from './types'
import diagnosis from './routes/diagnosis'
import chatbot from './routes/chatbot'
import weather from './routes/weather'
import community from './routes/community'
import library from './routes/library'
import admin from './routes/admin'
import { configureAiModels } from './lib/ai'

const app = new Hono<{ Bindings: Bindings }>()

// Inject secrets from process env fallback isn't needed on Cloudflare;
// OPENAI_API_KEY / OPENAI_BASE_URL are bound via wrangler secrets / vars.
app.use('*', async (c, next) => {
  // Allow the AI model to be overridden per-deployment via AI_MODEL /
  // AI_FALLBACK_MODEL vars (defaults: gpt-5 / gpt-5-mini).
  configureAiModels(c.env.AI_MODEL, c.env.AI_FALLBACK_MODEL)
  // Allow local dev (`npm run dev` with Vite) to pick up keys from process.env
  // In production these come from Cloudflare secrets (c.env is already populated).
  await next()
})

app.use('/static/*', serveStatic({ root: './public' }))

app.route('/api/diagnosis', diagnosis)
app.route('/api/chat', chatbot)
app.route('/api/weather', weather)
app.route('/api/community', community)
app.route('/api/library', library)
app.route('/api/admin', admin)

app.get('/', (c) => {
  return c.html(INDEX_HTML)
})

// SPA fallback: any non-API route serves the same shell (client-side router handles it)
app.get('*', (c) => {
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/static/')) return c.notFound()
  return c.html(INDEX_HTML)
})

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PlantGuard - AI Plant Disease Detection</title>
  <meta name="description" content="AI-powered plant disease detection, cultivation guidance, weather forecasts, and farmer community.">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🌿</text></svg>">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link href="/static/css/tokens.css" rel="stylesheet">
  <link href="/static/css/base.css" rel="stylesheet">
  <link href="/static/css/components.css" rel="stylesheet">
  <link href="/static/css/layout.css" rel="stylesheet">
  <link href="/static/css/responsive.css" rel="stylesheet">
</head>
<body>
  <a href="#app" class="skip-link">Skip to main content</a>
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked@9.1.6/marked.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dompurify@3.2.4/dist/purify.min.js"
    integrity="sha384-eEu5CTj3qGvu9PdJuS+YlkNi7d2XxQROAFYOr59zgObtlcux1ae1Il3u7jvdCSWu"
    crossorigin="anonymous"></script>
  <script type="module" src="/static/js/main.js"></script>
</body>
</html>`

export default app
