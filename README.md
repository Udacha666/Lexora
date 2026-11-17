# LEXORA / ORBIT

**Responsive cosmic-themed English-learning website** built with plain HTML, CSS and JavaScript. Works on mobile Safari and desktop browsers. Zero npm dependencies.

## Start now

- **Easiest / offline:** open `index.html` in a modern browser. Lessons, dictionary, profiles and spelling work. On some mobile browsers local files have limited persistent storage; hosting is preferable.
- **On Windows:** install Node.js 20+, then open a terminal in the project folder and run `npm start`. Visit `http://localhost:3000`.
- **Deploy:** upload project contents to a Node.js hosting service (Render, Railway, VPS) with start command `node server/server.mjs`. Node serves the site and acts as a secure(ish) API gateway. Use HTTPS. Set platform's `PORT` automatically if provided.
- **Static hosting:** GitHub Pages / Netlify static / Cloudflare Pages can host HTML/CSS/JS, but AI requires an independent backend and the current frontend assumes its API gateway is available at the **same origin** `/api/ai`. Set up a rewrite/proxy or deploy the Node server as the web site.

## Learning

- Exactly **5,000 distinct English/Russian flashcards**, 155 single words and 4,845 phrases/sentences; 2,451 B1 / 2,001 B2 / 548 C1.
- 177 starter vocabulary entries are manually curated from earlier Lexora work. 155 action phrases are also hand-curated. The remainder are **automatically composed from bilingual topical collocation templates**; they are useful practice items, not 4,668 independently lexicographically verified dictionary entries. Some combinations may feel unusual; editorial review is recommended before public educational release.
- Three-stage practice: discover → use in a sentence → spell from Russian translation.
- Offline sentence check is **only a heuristic** (checks target expression and basic punctuation), **not genuine grammar validation**.
- Grammar correctness and comments in Russian are checked by AI only after a working API integration is configured.
- Repetition schedule: 1, 3, 7, 14, 30, 60, 120 days.
- Daily goal 10 / 12 / 15, XP, study streak, dashboard and CEFR choices.
- English TTS provided by device/browser speech synthesis.
- Progress is stored locally. **Optional cloud sync** is now supported through Supabase Auth + PostgreSQL: see `ИНСТРУКЦИЯ_ОБЛАКО.md`. Profile includes JSON export/import for manual backup; API keys are deliberately excluded from cloud and backups.

## Accounts and cross-device synchronization

See **`ИНСТРУКЦИЯ_ОБЛАКО.md`** and the `supabase-setup.sql` migration. Supabase must be configured before real registration is available. Only non-secret **publishable key** may be put in `cloud-config.js` or entered in the profile. Users have private rows protected by RLS. AI API tokens remain device-only.

## Connecting AI from the website

1. Deploy the **whole project** to a server running `node server/server.mjs` on HTTPS.
2. Open **ИИ-центр → Добавить модель**. Choose OpenAI, OpenRouter, DeepSeek, Groq, Gemini, Cloudflare Workers AI, Together AI or a custom OpenAI-compatible gateway.
3. Enter model ID, API key (or let your personal server provide keys as env vars) and, where applicable, Cloudflare Account ID / custom HTTPS endpoint.
4. Save and choose a model. Use **Тест**, then AI chat or **Проверить с ИИ** during a lesson.
5. Unlimited model entries are configurable from the interface without rebuilding the website.

Server accepts key in each request **over HTTPS** and forwards it directly to the provider, without persisting it. In the browser, API keys are stored **only in volatile memory** unless you check *save until tab closes*, which uses `sessionStorage` (not encrypted and readable by scripts running in the same origin). Clear browsing data / close the tab when appropriate. Never hardcode keys in the HTML/JS or commit them to GitHub.

Env vars can be used for personal server configuration:

```text
PORT=3000
OPENAI_API_KEY=...
OPENROUTER_API_KEY=...
DEEPSEEK_API_KEY=...
GROQ_API_KEY=...
GEMINI_API_KEY=...
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
TOGETHER_API_KEY=...
CUSTOM_AI_KEY=...
CUSTOM_AI_HOSTS=your-authorized-domain.example,another.example
ORIGIN_ALLOWLIST=https://yourdomain.example
```

**Important:** the backend is meant for personal use / trusted users; if deployed publicly, protect `/api/ai` with authentication, server-side quotas and anti-abuse controls. Basic per-IP throttling is included but is not sufficient for public service abuse prevention. Do not enable arbitrary user-supplied URLs without a strict allowlist. Do not use unauthorised third-party proxy endpoints.

Cloudflare Workers AI is available with a Cloudflare API token + Account ID. Providers' free quotas, pricing and availability change; consult official provider dashboards.

## Install on iPhone as a web app

Open the hosted HTTPS URL in Safari → Share → **Add to Home Screen**. Lexora works like a standalone website/PWA, no IPA or Apple certificate needed. Offline studying works after the site and vocabulary cache are installed (AI requests always require internet).

## Structure

```text
index.html             main shell and navigation
cloud-config.js         optional Supabase URL and publishable key
supabase-setup.sql      database setup with RLS
ИНСТРУКЦИЯ_ОБЛАКО.md    cloud deployment and account setup
styles.css             responsive cinematic cosmic design
app.js                 learning, dictionary, AI model manager, profile
assets/icon.svg        original black-hole themed icon
data/vocabulary.js     5,000 bundled bilingual items
server/server.mjs      optional Node.js AI provider proxy
sw.js                  service worker for offline cache
manifest.webmanifest   web app manifest
tests/smoke.mjs        structural and vocabulary checks
```

The visual design is original and inspired by general space/cosmic cinematography; it does not use copyrighted movie artwork or music.
