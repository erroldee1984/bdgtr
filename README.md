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

```

The app needs no env file in development: it picks the right API on its own
(see `apps/mobile/.env.example` to override).

## Everyday commands (run from the repo root)

| Command | Does |
|---|---|
| `pnpm dev:api` | Starts the API on http://localhost:8787 (reloads on change) |
| `pnpm dev:web` | The app in your browser at http://localhost:8081, using the local API (run `pnpm dev:api` too) |
| `pnpm dev:phone` | The app on your phone in **Expo Go**, using the live API. Scan the QR code |
| `pnpm check` | Typecheck + lint + all unit tests (same as CI) |
| `pnpm test` | Unit tests only |
| `pnpm build:web` | Static website into `apps/mobile/dist` (plus Cloudflare `_headers`) |

## Testing on screens of different sizes

**Browser:** run `pnpm dev:api` and `pnpm dev:web`, then resize the window. The side
menu appears at 600px and wider. For exact sizes, open DevTools (F12), turn on the
device toolbar (Ctrl+Shift+M), choose "Responsive" and enter:

| Device | Size |
|---|---|
| Galaxy S24 FE / Fold 6 cover screen | 384 × 800 |
| Fold 6 unfolded, portrait | 707 × 760 |
| Fold 6 unfolded, landscape | 823 × 680 |

**Phone (Expo Go):** install Expo Go from the Play Store, run `pnpm dev:phone`
(first time: `npx eas-cli@latest login`), and scan the QR code with Expo Go. Saved
changes reload on the phone. The tunnel goes through Expo's servers, so it works
even though WSL isn't reachable from your Wi-Fi.

Cloud APK builds (`npx eas-cli@latest build -p android --profile preview`) are only
needed when a library with its own native Android code is added, or to share the app.

Check the API can reach Atlas: open http://localhost:8787/health/ready. It should show
`{"status":"ok","database":"ok"}`.

## Security notes

- Secrets live only in `apps/api/.env` locally and in the hosting provider's secret
  settings in production. `.env` files are git-ignored, and CI scans every push for leaked secrets.
- `EXPO_PUBLIC_*` values are compiled into the app and are **public**.
- See [docs/PLAN.md §10](docs/PLAN.md) for the full security design.
