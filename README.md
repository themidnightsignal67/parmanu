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

## Deploy on Railway

This repo is configured for Railway with **Railpack** + **Bun**.

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
