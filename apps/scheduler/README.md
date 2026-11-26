# bdgtr scheduler (Cloudflare Worker)

This Worker runs the API's scheduled jobs (docs/PLAN.md §1). Cloudflare cron times are in UTC, and Manila is UTC+8 all year:

| Cron (UTC) | Manila | Calls |
|---|---|---|
| `15 16 * * *` | 00:15 | `POST /internal/cron/fixed-postings`: adds today's fixed transactions |
| `0 23 * * *` | 07:00 | `POST /internal/cron/daily-digest`, then `POST /internal/cron/fixed-notices` |

Each call sends `Authorization: Bearer <CRON_SECRET>`. The API checks it in constant time. Every endpoint is safe to call twice, so the Worker retries network errors and 5xx responses (after 2 s, 4 s and 8 s). It doesn't retry 4xx responses such as a wrong secret. The Worker has no public address.

## One-time setup

The same secret goes in two places: Vercel (for the API) and the Worker. Never commit it or paste it into chat.

1. **Make a secret** in a terminal on your computer:
   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
2. **Vercel:** open the `bdgtr-api` project → Settings → Environment Variables. Add `CRON_SECRET` with that value for **Production** and mark it Sensitive. Then redeploy the latest production deployment so it takes effect.
3. **Cloudflare:** from `apps/scheduler`:
   ```sh
   npx wrangler@4 login          # opens the browser once
   npx wrangler@4 deploy         # creates "bdgtr-scheduler" with its two crons
   npx wrangler@4 secret put CRON_SECRET   # paste the same value when asked
   ```

## Checking it

- Cloudflare dashboard → Workers & Pages → `bdgtr-scheduler` → **Logs** shows each run and what the API answered, e.g. `{"date":"2026-11-27","posted":1,…}`.
- **Re-run a missed day:** call the endpoint with a date from the last 7 days:
  ```sh
  curl -X POST https://bdgtr-api.erroldee.com/internal/cron/fixed-postings \
    -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" -d '{"date":"2026-11-27"}'
  ```
  For `daily-digest` and `fixed-notices`, the date is the morning it runs for. The summary covers the day before it.

## Changing it

Edit `src/index.ts` or `wrangler.toml`, run `pnpm --filter @bdgtr/scheduler test`, then `npx wrangler@4 deploy` again. Merging to GitHub doesn't deploy the Worker.
