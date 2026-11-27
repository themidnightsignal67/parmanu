# Parmanu OSINT

Full-stack OSINT investigation platform (Express + React/Vite + TypeScript).

## Run locally

**Prerequisites:** Node.js 20+ and/or [Bun](https://bun.sh)

1. Install dependencies:
   ```bash
   bun install
   # or: npm install
   ```
2. Copy env example and fill keys:
   ```bash
   cp .env.example .env
   ```
3. Start in development (Vite HMR + API):
   ```bash
   bun run dev
   # or: npm run dev
   ```

## Deploy on Vercel

1. Import the GitHub repo in the [Vercel dashboard](https://vercel.com/new).
2. Framework Preset: **Other** (config is in `vercel.json`).
3. Set **all** environment variables from `.env.example` in  
   Project → Settings → Environment Variables (Production + Preview).
4. Important build-time vars (must be present at build):
   - `VITE_MAPTILER_API_KEY`
   - `VITE_CARTO_API_KEY` (optional)
5. After the first deploy, set `APP_URL` to your Vercel domain (e.g. `https://parmanu.vercel.app`) and redeploy.
6. Health check: `GET /api/health`

**Notes / limitations on Vercel**
- The app runs as a single serverless function (`api/index.ts`) that hosts Express.
- In-memory investigation state is lost on cold starts.
- Use `PARMANU_DATA_DIR=/tmp` (ephemeral). For durable credits prefer Railway + volume.
- Max duration is 60s on Pro (Hobby is lower). Long OSINT scans may hit the limit.

### Env vars to paste in Vercel

Copy from your local `.env` / the values you already have. Never commit real secrets.

## Deploy on Railway

This repo is also configured for Railway with **Railpack** + **Bun**.

### 1. Connect the repo
- Create a new Railway project → Deploy from GitHub → select `parmanu`.
- Railway will use `railway.json` (RAILPACK builder, build + start commands, healthcheck).

### 2. Required environment variables
Set these in the Railway service **Variables** tab (see `.env.example` for the full list):

| Variable | Required | Notes |
|----------|----------|--------|
| `GEMINI_API_KEY` | Yes | Primary Gemini key for AI summaries |
| `NODE_ENV` | Auto | Set to `production` by start command |
| `PORT` | Auto | Railway injects this |
| `HOST` | Optional | Defaults to `0.0.0.0` |
| `APP_URL` | Recommended | Your public Railway URL, e.g. `https://parmanu-xxx.up.railway.app` |
| `PARMANU_COOKIE_SECRET` | Recommended | Random secret for credit cookie HMAC |
| `PARMANU_DATA_DIR` | Optional | Path for persistent credit ledger (mount a Railway Volume) |
| `VITE_MAPTILER_API_KEY` | Optional | Map tiles (build-time) |
| Extra Gemini keys / GHunt / phone APIs | Optional | See `.env.example` |

### 3. Persistent storage (credits)
If you want the daily credit ledger to survive restarts:
1. Add a **Volume** to the service.
2. Mount it at e.g. `/data`.
3. Set `PARMANU_DATA_DIR=/data`.

### 4. Public domain
Settings → Networking → Generate Domain.

Health endpoint: `GET /api/health`

### Build & start (what Railway runs)
```text
Build:  bun install --frozen-lockfile && bun run build   # produces dist/
Start:  NODE_ENV=production bun run server.ts           # serves API + dist SPA
```

## Scripts

| Script | Description |
|--------|-------------|
| `dev` | Local dev server (tsx + Vite middleware) |
| `build` | Vite production build → `dist/` |
| `start` | Production server (Bun, expects `dist/`) |
| `start:node` | Same with Node + tsx fallback |
| `lint` | Typecheck |
| `vercel-build` | Build step used by Vercel |
