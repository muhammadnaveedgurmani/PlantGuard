# 🌿 PlantGuard — AI Plant Disease Detection & Farming Assistant

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?style=flat-square&logo=hono&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat-square&logo=cloudflareworkers&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=flat-square&logo=openai&logoColor=white)

</div>

## Project Overview
- **Name**: PlantGuard
- **Goal**: A real, production-grade web app that helps farmers and plant
  lovers detect plant diseases, get AI-powered cultivation advice, chat with
  an AI plant-care assistant, check real weather forecasts, and connect with
  a farming community.
- **This is a complete rewrite** of the original Python/Streamlit/TensorFlow
  prototype. It now runs entirely on **Hono + TypeScript + Cloudflare
  Workers/Pages**, using **real AI (GPT-5 vision & chat)** instead of a
  fixed 35-class CNN model, and **real weather data** instead of randomly
  generated numbers.

## ✅ Key Features (all fully functional)
1. **AI Vision Plant Diagnosis** — Upload any leaf photo. The AI:
   - Verifies it's actually a plant/leaf photo
   - Identifies the plant species
   - Detects disease/pest issues (not limited to a fixed class list — works
     on virtually any plant/disease)
   - Returns confidence %, severity, symptoms, spread, treatment, prevention
   - Saves every diagnosis to history (backed by Cloudflare D1)
2. **AI Plant Care Chatbot** — Live conversational assistant for any
   plant/farming question, with persisted chat history per session.
3. **Real Weather Forecasts** — Live 7-day forecast via Open-Meteo (free,
   no API key), with automatic IP-based location detection (ip-api.com).
   No more fake/random weather data.
4. **Disease Library** — AI-generated, on-demand disease info (symptoms,
   spread, treatment, prevention) for any disease, cached in D1 after first
   lookup so repeat queries are instant and don't re-call the AI.
5. **Cultivation Tips** — AI-generated growing guides (watering, sunlight,
   temperature, soil, fertilizer, spacing) for any plant/crop, also cached.
6. **Farmer Community Forum** — Create posts, like, comment, edit, delete,
   all persisted in D1 (not local JSON files, so it works properly in a
   serverless/edge deployment).
7. **Diagnosis History** — Per-session history with stats (total scans,
   average confidence, today's count), expandable records, delete support.

## 🌐 URLs
- **Local Sandbox Preview**: (ask the agent for `GetServiceUrl` — the
  sandbox URL changes each session)
- **GitHub**: https://github.com/muhammadnaveedgurmanii-png/PlantGuard
- **Production**: Not yet deployed — see "Deployment" below

## 🏗️ Tech Stack
| Layer | Technology |
|---|---|
| Backend framework | [Hono](https://hono.dev) (TypeScript, edge-native) |
| Runtime / hosting | Cloudflare Workers / Pages |
| Database | Cloudflare D1 (SQLite at the edge) |
| Image storage | Cloudflare R2 (uploaded leaf photos) |
| AI — vision diagnosis, chatbot, content generation | GPT-5 via OpenAI-compatible Chat Completions API |
| Weather data | Open-Meteo (forecast) + ip-api.com (geolocation) |
| Frontend | Vanilla JS SPA (hash-based router) + Tailwind CSS (CDN) + Font Awesome |

## 🗄️ Data Architecture

### Storage Services Used
- **Cloudflare D1** (binding: `DB`) — all structured/relational data
- **Cloudflare R2** (binding: `IMAGES`) — uploaded leaf photos

### Data Models (D1 tables)
| Table | Purpose |
|---|---|
| `diagnoses` | Every AI diagnosis result: plant, disease, confidence, severity, symptoms/spread/treatment/prevention (JSON arrays), linked R2 image key |
| `posts` | Community forum posts |
| `comments` | Comments on posts |
| `post_likes` | Per-session like tracking (prevents double-likes) |
| `chat_messages` | AI chatbot conversation history per session |
| `cultivation_cache` | Cached AI-generated cultivation guides per plant |
| `disease_cache` | Cached AI-generated disease info per disease name |

### Session Model
No login/signup — each browser gets an anonymous `pg_session` cookie
(1-year expiry) that scopes diagnosis history, chat history, and
"who liked/authored what" per visitor.

## 📡 API Endpoints
| Method | Path | Description |
|---|---|---|
| POST | `/api/diagnosis/analyze` | Upload image (`multipart/form-data`, field `image`) → AI diagnosis |
| GET | `/api/diagnosis/history` | List this session's diagnosis history (`?date=YYYY-MM-DD` optional) |
| DELETE | `/api/diagnosis/history/:id` | Delete a history record |
| GET | `/api/diagnosis/image/:key` | Serve a stored leaf image from R2 |
| POST | `/api/chat/send` | `{ message }` → AI chatbot reply (context-aware) |
| GET | `/api/chat/history` | Get this session's chat history |
| DELETE | `/api/chat/history` | Clear chat history |
| GET | `/api/weather/detect` | IP-based location detection |
| GET | `/api/weather/forecast?city=X` or `?lat=&lon=` | Real 7-day forecast |
| GET | `/api/community/posts` | List all posts + comments |
| POST | `/api/community/posts` | `{ author, title, content }` → create post |
| PUT | `/api/community/posts/:id` | Edit own post |
| DELETE | `/api/community/posts/:id` | Delete own post |
| POST | `/api/community/posts/bulk-delete` | `{ ids: number[] }` |
| POST | `/api/community/posts/:id/like` | Toggle like |
| POST | `/api/community/posts/:id/comments` | `{ author, content }` |
| GET | `/api/library/plants` \| `/diseases` | Dropdown option lists |
| GET | `/api/library/cultivation?plant=X` | AI cultivation guide (cached) |
| GET | `/api/library/disease?name=X` | AI disease info (cached) |

## 👤 User Guide
1. Open the app → land on the animated homepage → click **"Get Started"**
2. **Diagnose a plant**: Diagnosis → upload a leaf photo → "Analyze Leaf"
3. **Ask the AI**: AI Chat → type any plant/farming question
4. **Check weather**: Weather → auto-detects your city, or type any city
5. **Browse info**: Disease Library / Cultivation Tips → pick from dropdown
6. **Community**: post your experience, like/comment on others' posts
7. **History**: review all your past diagnoses with stats

## 🚀 Deployment
- **Platform**: Cloudflare Pages (Workers)
- **Status**: ✅ Fully built and tested locally (sandbox) — not yet deployed to production Cloudflare
- **Required secrets before deploying**:
  - `OPENAI_API_KEY` / `OPENAI_BASE_URL` (set via `wrangler pages secret put` or the Deploy panel)
- **D1 database**: create with `npx wrangler d1 create plantguard-production`, put the returned `database_id` into `wrangler.jsonc`, then run migrations:
  ```bash
  npm run db:migrate:prod
  ```
- **R2 bucket**: create with `npx wrangler r2 bucket create plantguard-images`
- **Deploy**: `npm run deploy`

## 🧪 Local Development
```bash
npm install
npm run build
npx wrangler d1 migrations apply plantguard-production --local
pm2 start ecosystem.config.cjs
curl http://localhost:3000
```
Requires a `.dev.vars` file (gitignored) with:
```
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://www.genspark.ai/api/llm_proxy/v1
```

## 🔜 Not Yet Implemented / Future Ideas
- Real user accounts / authentication (currently anonymous session-based)
- Push notifications for weather alerts (e.g. frost warnings)
- Multi-language UI toggle (chatbot already understands Roman Urdu)
- Image gallery/comparison for tracking plant health over time
- Admin moderation tools for the community forum

## 📜 What Changed From the Original Prototype
The original was a Python + Streamlit + TensorFlow app with:
- A fixed 35-class CNN model (`plant_disease_model.h5`) — replaced with
  open-ended GPT-5 vision diagnosis (any plant, any disease)
- Fake/random weather data — replaced with real Open-Meteo forecasts
- Disease info for only 4 of 35 classes — replaced with AI-generated info
  for **any** disease name, on demand
- Local JSON file storage (`posts.json`, `diagnosis_history.json`) — not
  viable on serverless — replaced with Cloudflare D1
- No chatbot — added a full AI plant-care assistant
- Abandoned/empty scaffolding (`pages/`, `models/`, `utils/`) — removed;
  clean Hono route structure instead
