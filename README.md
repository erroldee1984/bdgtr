# bdgtr

Household budgeting and expense tracker for **Android and the web**, built with
Expo (React Native + TypeScript), a Hono API and MongoDB Atlas.

The full plan, decisions and milestones are in [docs/PLAN.md](docs/PLAN.md).

## Repository layout

| Path | What it is |
|---|---|
| `apps/mobile` | Expo app (Expo Router). Builds the Android app and the static website. |
| `apps/api` | Hono API. The only place that holds secrets or talks to MongoDB. |
| `packages/shared` | Pure TypeScript shared by both: money (₱, centavos), Manila dates, Zod schemas. |
| `docs/` | Plan and documentation. |

## Prerequisites

- Node.js (version in `.nvmrc`), installed with [nvm](https://github.com/nvm-sh/nvm): `nvm install`
- pnpm: `npm install -g pnpm`

## First-time setup

```bash
pnpm install

# API secrets (never commit this file)
cp apps/api/.env.example apps/api/.env
#   then edit apps/api/.env and paste your Atlas connection string into MONGODB_URI

# App config (public values only)
cp apps/mobile/.env.example apps/mobile/.env.local
```

## Everyday commands (run from the repo root)

| Command | Does |
|---|---|
| `pnpm dev:api` | Starts the API on http://localhost:8787 (reloads on change) |
| `pnpm dev:mobile` | Starts Expo. Press `w` for web, `a` for an Android emulator/device |
| `pnpm check` | Typecheck + lint + all unit tests (same as CI) |
| `pnpm test` | Unit tests only |
| `pnpm build:web` | Static website into `apps/mobile/dist` (plus Cloudflare `_headers`) |

Check the API can reach Atlas: open http://localhost:8787/health/ready. It should show
`{"status":"ok","database":"ok"}`.

## Security notes

- Secrets live only in `apps/api/.env` locally and in the hosting provider's secret
  settings in production. `.env` files are git-ignored, and CI scans every push for leaked secrets.
- `EXPO_PUBLIC_*` values are compiled into the app and are **public**.
- See [docs/PLAN.md §10](docs/PLAN.md) for the full security design.
