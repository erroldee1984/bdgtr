# bdgtr — Budgeting & Expense Tracker: Implementation Plan

A household budgeting app for **Android and the web**, built from one Expo codebase and backed by MongoDB Atlas. Requirements source: `bdgtr.pdf`.

---

## 0. Decisions

### Confirmed
| # | Decision |
|---|----------|
| C1 | **Shared household budget.** Each member signs in with their own account. |
| C2 | **Currency is Philippine Peso (₱, `PHP`)**, formatted with `en-PH`. Timezone is `Asia/Manila`, which has no daylight saving, so month boundaries stay simple. |
| C3 | **Web version** alongside Android, served on **`bdgtr.erroldee.com`** (Cloudflare). `home.erroldee.com` is already in use and is left alone. |
| C4 | **Hosting must be free** (see §2), and Android distribution must avoid the US$25 Play fee (see §2a) |
| C5 | **Budget alerts go to every household member** once a threshold is crossed: native push on Android, plus **browser notifications** (Web Push) on web and an in-app toast. Each member can mute alerts on their own devices. |
| C6 | **One person can own and belong to multiple households**, with any role in each (§3) |
| C7 | **Three roles: House Owner, Co-Owner, House Member.** Full permission matrix in §3. |
| C8 | **Pins are personal and stored only on the device** (not in the database). Losing them, e.g. after reinstalling or switching devices, is acceptable. |
| C9 | **Daily 7:00 AM summary notification** to every household member: yesterday's total household spend and the budget remaining for the month, worded from the **household's** point of view (§6.11) |
| D1 | **House Members can edit or delete only their own transactions.** Swipe-delete and editing appear only on their own rows. They can't touch other people's transactions or any setup data. |
| D2 | **Only the House Owner can delete the household or transfer ownership.** A Co-Owner can do neither. |
| D3 | **On the 1st of the month**, the 7 AM summary reports yesterday's spend, **last month's final result** (remaining or over), and **the new month's budget** |
| D4 | **The 7 AM summary is still sent on ₱0 days**, as "No spending recorded yesterday". Each member can turn the daily summary off. |
| D5 | **Sign-in is Google Sign-In via Clerk**: free tier, supports Expo on native and web, and keeps the OAuth client secret inside Clerk |
| D6 | **No offline mode in v1.** It's planned as future functionality (§15): view the last synced data and queue transactions that send automatically once back online. v1 includes the groundwork so it can be added without rework. |

The "D" rows are the defaults you approved, so they're listed here as decisions.

---

## 1. Architecture

```
 Android app (Expo) ─┐                         ┌──────────────────────────┐       ┌───────────────────┐
                     ├── HTTPS + Clerk JWT ──▶ │ API                      │ ─TLS─▶│ MongoDB Atlas M0  │
 Web app (Expo web) ─┘   + X-Household-Id      │ bdgtr-api.erroldee.com   │       │ Singapore region  │
 bdgtr.erroldee.com                            │ Hono on Vercel (Node)    │       └───────────────────┘
 Cloudflare Pages + service worker             │ secrets live here only   │
  Cloudflare Worker cron ── 00:15 / 07:00 ──▶  │ jobs: fixed txns, digest │
                                               └─────┬──────────────┬─────┘
                                                     ▼              ▼
                               Expo Push → FCM → Android    Web Push (VAPID) → members' browsers
```

**Why a backend is required.** The apps must never connect to MongoDB directly. A connection string bundled into an APK or web bundle can be read by anyone. MongoDB's client-side options (Data API, Device Sync) are deprecated. The API is the only place to:
- keep the Atlas connection string, the Clerk secret key, the Expo push token and the Web Push VAPID private key,
- send budget alerts to **every** member's devices, not just the device that entered the spend,
- check on every request that the signed-in user belongs to the household being accessed,
- run the daily auto-posting of fixed transactions while every phone is off.

**One codebase, two platforms.** Expo builds the Android app and a static web app (`react-native-web`, `npx expo export -p web`) from the same source. Where a platform needs different code, a file with a `.web.tsx` suffix holds the web version (date picker, swipe rows, notifications).

### Repo layout (pnpm monorepo)

```
bdgtr/
├─ apps/
│  ├─ mobile/        Expo (TypeScript, Expo Router): builds Android + web
│  └─ api/           Hono (TypeScript) deployed as a Vercel function
├─ packages/
│  └─ shared/        Zod schemas, types, pure budget logic, money formatting
└─ docs/
```

### Client stack (Android + web)

| Layer | Choice | Why |
|---|---|---|
| UI framework | **React Native**, through **Expo** (latest stable SDK) | One codebase for Android and web (`react-native-web`). **EAS Build** produces the Android build and **Expo web export** produces the static site. |
| Language | **TypeScript** in `strict` mode, across the app, the API and `shared` | Types come from the Zod schemas, so a single type defines the shape the API returns and the app reads |
| Navigation | **Expo Router**: needed, not optional | File-based routes become real URLs on web (`/spend/2026-11`, `/invite/<token>`), and invite links open the right screen on Android (deep links / App Links). Responsive layouts switch between bottom tabs and a side rail. |
| Server state | **TanStack Query** | Caching, retries, optimistic pin and delete. Its cache can later be saved to the device for offline viewing (§15). |
| Local persistence | **Local Storage**: `@react-native-async-storage/async-storage`. On Android it's on-device storage; on web it's backed by the browser's `localStorage`. | Same API on both platforms. Wrapped in one `storage` module so the backend can change later (e.g. MMKV or IndexedDB for offline) without touching screens. |
| Secure persistence | **expo-secure-store** (Android Keystore) | Auth tokens only. Tokens never go in Local Storage. |

**What Local Storage keeps in v1** (all keys are namespaced `bdgtr:<userId>:…`):

| Data | Key | Cleared on sign-out? |
|---|---|---|
| Active household | `activeHousehold` | Yes |
| Personal pins | `pins:<householdId>` | Yes |
| Breakdown view preferences (sort, last filters) | `prefs:breakdown:<householdId>` | Yes |
| Recently used categories (for the entry screen) | `recentCategories:<householdId>` | Yes |
| Unsaved transaction draft (survives the app being closed mid-entry) | `draft:<householdId>` | Yes |
| Notification opt-in state for this device | `notifications` | Yes |
| Schema version, for migrating stored data | `storageVersion` | No |

- **Never in Local Storage:** tokens, Atlas credentials, or any secret.
- **No financial data is cached in v1.** That only starts with the offline feature (§15), together with its protections.
- Stored values are **validated with Zod on read**. Corrupt or outdated data is discarded and the default used, never crashing the app.

**Other client libraries:**
- **react-hook-form + Zod** for forms
- **react-native-gifted-charts** (SVG) for charts. It renders on both Android and web without the heavy Skia/WASM load.
- **react-native-gesture-handler + Reanimated** for swipe rows (Android and touch web)
- **expo-notifications** (Android push), **expo-secure-store** (Android tokens), **@clerk/clerk-expo** for auth on both platforms
- **Web:** a service worker (`sw.js`) handles **Web Push** and makes the site an installable **PWA** (manifest and icons)
- **App icon** ("category lines house": blue roof, three budget bars). Android: `assets/images/` holds the 1024 px adaptive foreground and monochrome layers (background colour `#161A31` in app.json), the store icon, the splash mark and the 96 px white notification icon. These are rendered from the pack's SVG masters, because the app uses Continuous Native Generation and has no `android/res`. Web: `public/` holds favicon.ico/.svg, apple-touch-icon, the 192/512 icons in "any" and "maskable" versions, and `site.webmanifest`, all linked from `+html.tsx`. `scripts/__tests__/app-icons-test.ts` checks that every referenced icon exists at its stated size.

### API stack
- **Hono** runs unchanged on Vercel, Node or Cloudflare Workers, so the host can change later without a rewrite
- Official **MongoDB Node driver** plus Zod. The client is cached across warm invocations.
- Clerk JWT verification (JWKS)
- **Scheduled jobs** (built in M5b: `apps/scheduler`, deployed with `wrangler`, setup steps in its README; the 07:00 run calls the daily summary, then the fixed-transaction notices) are triggered by a tiny **Cloudflare Worker with Cron Triggers** (free, minute-accurate). It calls the API's internal endpoints with a `CRON_SECRET`:
  - `00:15` Manila (`15 16 * * *` UTC): post today's fixed transactions
  - `07:00` Manila (`0 23 * * *` UTC, *the previous UTC day*): daily summary notification

  We don't use Vercel Cron because on the free Hobby plan it only guarantees the job runs *somewhere within the scheduled hour*. That's fine for fixed postings but not for a "7 AM" notification.
- **`expo-server-sdk`** (Android push) and **`web-push`** (browser push, VAPID). Sending happens after the response through Vercel's `waitUntil`, so saving a spend never waits on notifications.

---

## 2. Free hosting recommendation

| Piece | Service | Free tier fit | Caveats |
|---|---|---|---|
| **Web app** | **Cloudflare Pages** at `bdgtr.erroldee.com` | Unlimited bandwidth and requests for static sites, free SSL. Your domain is already on Cloudflare, so DNS is one click. | None for this use |
| **API** | **Vercel Hobby** at `bdgtr-api.erroldee.com` | Serverless Node functions with no sleep or cold-start delay like Render's free tier. Daily cron included. Can run in the Singapore region (`sin1`), next to Atlas. | Hobby is for **personal, non-commercial** use, which a household app is. Dynamic outbound IPs (see §10). |
| **Database** | **MongoDB Atlas M0** (Singapore) | 512 MB, years of household transactions | No automated backups, so §10 adds a scheduled export |
| **Auth** | **Clerk** free plan | Monthly active user allowance far beyond a household. Google sign-in, Expo SDK, works on web. | Production needs your own Google OAuth client (set up in M0) |
| **Android push** | **Expo Push + Firebase Cloud Messaging (FCM)** | Free | Needs a free Firebase project |
| **Browser push** | **Web Push** (standard browser API, VAPID keys) | Free. No third-party service: the API talks to Chrome, Firefox, Edge and Safari push servers directly. | See §2b for browser support |
| **Scheduler** | **Cloudflare Workers Cron Triggers** | Free plan includes cron triggers, on the same Cloudflare account as your domain | — |
| **Android builds** | **EAS Build** free plan | Monthly build quota is plenty for this project | Builds queue behind paid users |
| **Android distribution** | APK from `bdgtr.erroldee.com/download` | Free | See §2a |

**Alternatives I didn't pick:**
- **Render free:** sleeps after 15 minutes idle, so the first request takes about 30–60 seconds. That's bad for quick entry.
- **API on Cloudflare Workers:** keeps everything in one place, but the MongoDB driver on Workers is less proven. Because the API uses Hono, it can move there later if that improves.

**Planned subdomains on your Cloudflare domain:**

| Hostname | Points to | Cloudflare proxy |
|---|---|---|
| `bdgtr.erroldee.com` | Cloudflare Pages | Proxied (orange cloud) |
| `bdgtr-api.erroldee.com` | Vercel (CNAME) | DNS only (grey cloud), as Vercel recommends |
| `clerk.bdgtr.erroldee.com` + the other records Clerk lists | Clerk | DNS only |
| `home.erroldee.com` | *(existing; untouched)* | — |

All the new names sit under `bdgtr`, so none of them collide with `home.erroldee.com` or anything you add later. The API uses `bdgtr-api` (one level deep) rather than `api.bdgtr` (two levels), so Cloudflare's free Universal SSL certificate still covers it if it's ever switched to Proxied.

Step-by-step Cloudflare instructions will come in M0. §13 has the outline.

### 2a. Android distribution without the US$25 Play fee

| Option | Cost | Works for a household? | Verdict |
|---|---|---|---|
| **Private app via Google Admin console / managed Google Play** | No developer fee: Google creates a Play Console account for the organization and waives the US$25 | **Not in practice.** Private apps only go to **managed accounts in your Google Workspace or Cloud Identity organization**, on devices enrolled in Android management (a work profile on personal phones). Family members' personal Gmail accounts can't install it. Each member would need an `@erroldee.com` Workspace or Cloud Identity account and a work profile on their phone, and the advanced Android management that private apps need typically comes with paid editions. | ❌ Avoids US$25 but costs more and adds friction |
| **Sideloaded APK** downloaded from `bdgtr.erroldee.com/download` | Free | Yes. Members allow "install unknown apps" once. | ✅ **Use for v1** |
| **Free "limited distribution" developer account** (Android developer verification) | Free; no ID or fee for hobbyists and students | Yes. It covers up to **20 devices**, enough for a household. | ✅ **Register when it's available in the Philippines**, so sideloaded installs keep working after verification is enforced |
| **PWA install** (Add to Home screen from Chrome) | Free | Yes. Works today on any Android phone, with browser push notifications. | ✅ Fallback for anyone who can't or won't sideload |
| Google Play (closed testing track) | US$25 once | Yes | Optional later |

**Why the developer-verification row matters.** Google is rolling out *Android developer verification*: apps installed on certified Android phones, including sideloaded ones, must come from a verified developer. Reported timing is late 2026 in Brazil, Indonesia, Singapore and Thailand, with other countries in 2027. Reports also differ on dates, so we'll recheck Google's official FAQ at M6. For hobbyists Google announced a **free limited-distribution account** (up to 20 devices). Unverified installs stay possible through an "advanced" flow and ADB, but that flow is deliberately inconvenient.

**Plan:** ship the APK from our own site in v1, register the free limited-distribution account once it's open to us, and keep the PWA as the zero-install fallback.

**Rechecked 27 Nov 2026 (M6c),** from Google's developer-verification pages and their 19 Nov 2026 post:
- **Enforcement:** started 30 Sep 2026 in Brazil, Indonesia, Singapore and Thailand. The **global rollout begins January 2027**, expanding to all countries over several months. The Philippines isn't named, so no fixed date yet.
- **Limited-distribution account:** it's **open now**. It's free, needs no government ID and covers **up to 50 devices** (raised from 20). You register package names, plus their signing keys, in the Android Developer Console (`android.google.com/developerconsole`). Phones are authorised by QR code or link. Keep the signing key safe: losing it means packages can't be registered.
- **Unregistered apps after enforcement:** a one-time "advanced flow" (developer mode, a no-coaching check, restart, a **one-day wait**), then "Install anyway"; or ADB with no wait. Updates fail while the advanced flow is off.
- **To do (owner, before 2027):** register `com.erroldee.bdgtr` with the EAS signing key's certificate. This needs the owner's Google account, 2-Step Verification and a payments profile.

**Distribution as built (M6c):**
- `bdgtr.erroldee.com/download` is a public install guide: numbered steps, Play Protect's "Install anyway", updating, notifications, and the browser alternative.
- The APK is too big for Cloudflare Pages (25 MB per file; the M4 preview APK was 115 MB), so it's published as a **GitHub Release asset named exactly `bdgtr.apk`**. The page links to `releases/latest/download/bdgtr.apk`.
- `APK_AVAILABLE` in `src/app/download.tsx` stays `false`, showing "first release is being prepared", until the first release is published.
- **Each release:** build the APK (production profile), publish a GitHub release with `bdgtr.apk` and its SHA-256 in the notes, then check the download link.
- **PWA check (M6c):** Chrome's installability check reports no errors (live site and build). The manifest gained `id`, `scope` and long-press shortcuts (Add spend, Spend).

### 2b. Notifications to all household members

When a spend crosses a threshold (§6.3), the API **fans out the alert to every active member of that household**. That includes the person who entered the spend, minus anyone who has muted alerts.

| Where the member is | How the alert arrives |
|---|---|
| Android app (background or closed) | System notification through Expo Push → FCM on the "Budget alerts" channel. Tapping it opens the Alerts tab for that household. |
| Android app (open and in front) | **In-app toast** instead of a duplicate system notification, plus the Alerts list badge |
| Browser tab open on `bdgtr.erroldee.com` | **In-app toast** (top-right "growl" on desktop, top banner on phones), announced to screen readers, plus the Alerts list badge |
| Browser closed, or the tab in the background (Chrome, Edge, Firefox on desktop or Android) | **Web Push system notification**, the OS-level "growl", shown by the service worker even when no tab is open |
| Safari on iPhone or iPad | Web Push only works once the site is **added to the Home Screen** (installed PWA, iOS 16.4+). Otherwise, in-app toast only. |
| Every member | The alert is also stored and appears in the **Alerts** tab, so nothing is lost if a notification is dismissed or blocked |

**How it's built:**
- **Opt-in:** in Settings, "Enable notifications on this device" calls `Notification.requestPermission()`. Browsers only allow the permission prompt after a click, never on page load.
  - The click registers the service worker's push subscription and the API saves it to `pushSubscriptions`.
  - Android registers its Expo push token the same way.
- **Multiple devices:** a member with a phone and a laptop gets the alert on both. Each device has its own row in `pushSubscriptions`, labelled e.g. "Chrome on Windows". Settings lists them and lets the member remove any.
- **Cleanup:** subscriptions that the push service reports as expired (HTTP 404/410, or Expo's `DeviceNotRegistered`) are deleted automatically.
- **Payload:** the title and body carry the household name, category and percentage, in the same household-first wording as the daily summary, e.g. "Dela Cruz household has used 92% of its ₱8,000 Groceries budget" or "Dela Cruz household is over its ₱40,000 monthly budget by ₱1,150". **No transaction descriptions**, because notification text can show on a lock screen.
- **Multiple households:** the alert carries `householdId`, and tapping it switches to that household.
- **Security and privacy (built in M2b-2):** the server only delivers to the real push services (Google FCM, Mozilla, Microsoft WNS, Apple), never to an arbitrary address a client sends. Signing out forgets this browser and unsubscribes it, and on sign-in an already-subscribed browser is re-registered to whoever is signed in, so a shared computer never shows the previous person's alerts. VAPID keys: public/subject as plain Vercel variables, private key as a Vercel secret (and separate local-development keys in `apps/api/.env`). The VAPID subject is the website address, not a personal email.
- **Foreground:** if the app is open and in front, the service worker hands the alert to the page as a toast instead of showing a system notification; the same alert from the save's reply and a push is shown once.
- **Android (built in M2b-3):** More → Settings → "Turn on notifications" creates the "Budget alerts" channel (Android 13 only prompts once a channel exists), asks Android's permission, gets the Expo push token and registers it as an `expo` device (label e.g. "Samsung SM-A546E", never the phone's personal name). The token is remembered in secure storage; "on" means permission granted and a registered token.
  - The server sends only to Expo's fixed address (`exp.host`); the token goes in the body and must match `ExponentPushToken[…]`. `DeviceNotRegistered` deletes the device. An Expo access token is optional (`EXPO_ACCESS_TOKEN`, a Vercel secret, only if "enhanced security for push" is turned on).
  - Turning it off when the server can't be reached says so and stays on, since alerts would keep arriving. Signing out while offline drops the phone's push registration instead, so the previous person's alerts stop. App start and sign-in re-register a switched-on phone to whoever is signed in and pick up a rotated token.
  - Firebase: `google-services.json` is not committed. EAS builds get it from the `GOOGLE_SERVICES_JSON` file variable (`app.config.ts` adds it when present). The FCM V1 service-account key is uploaded to EAS credentials and never stored in the repo.

---

## 3. Households, members & invites

### Model
- A **user** (Clerk identity) can belong to **many households** through `memberships`.
- Every data request sends `X-Household-Id`. The API looks up an **active membership** for `(userId, householdId)`. If there isn't one, it returns **404**, so the caller can't tell whether the household exists. Role checks happen after that.
- The **active household** is remembered per device (secure-store on Android, `localStorage` on web; it's only an ID, not a secret). If it's missing or no longer valid, the user picks one.
- A person can be **House Owner of several households** and a Co-Owner or House Member in others. Their role is per household, and the UI adapts to the role in the active household.

### Roles & permissions

Each household has **exactly one House Owner**, any number of Co-Owners, and any number of House Members.

| Capability | House Owner | Co-Owner | House Member |
|---|:-:|:-:|:-:|
| View dashboard, breakdown, budgets, categories, fixed transactions, alerts | ✅ | ✅ | ✅ (read-only) |
| Enter transactions | ✅ | ✅ | ✅ |
| Edit or delete **own** transactions | ✅ | ✅ | ✅ (D1) |
| Edit or delete **anyone's** transactions | ✅ | ✅ | ❌ |
| Bulk-post fixed transactions | ✅ | ✅ | ❌ |
| **Data management tools:** categories, fixed transactions, monthly and category budgets | ✅ | ✅ | ❌ |
| Rename household | ✅ | ✅ | ❌ |
| Send, re-share or revoke invites | ✅ | ✅ | ❌ |
| Invite as **Co-Owner** or House Member, or change a member's role between those two | ✅ | ✅ | ❌ |
| Remove House Members and Co-Owners | ✅ | ✅ | ❌ |
| **Remove or demote the House Owner** | — | ❌ | ❌ |
| Transfer House Ownership | ✅ | ❌ (D2) | ❌ |
| Delete household | ✅ | ❌ (D2) | ❌ |
| Leave household | after transferring ownership | ✅ | ✅ |
| Mute own alerts or daily summary; enable own devices | ✅ | ✅ | ✅ |

- **Enforcement is on the server.** Every route declares the minimum role it needs, and House-Owner protection is a hard check: any request that targets the House Owner's membership is rejected unless it's the Owner acting on themselves. The UI **hides** controls a role can't use rather than greying them out, so House Members see read-only versions of Budgets, Categories and Fixed Transactions with no edit affordances.
- **Transfer ownership:** the House Owner picks an existing member, who becomes House Owner. The old Owner becomes a Co-Owner and can leave afterwards. Both changes happen in one database transaction.

### Flows
1. **First sign-in with no invite:** "Create your household" asks for a name and the default monthly budget (₱). The household starts with one category, **Groceries**. The user becomes House Owner. Existing users can create more households from the switcher at any time.
2. **Invite** (House Owner or Co-Owner):
   - Enter the invitee's email and role (Co-Owner or House Member; House Owner is never invited, only transferred). The API creates an invite with a **random 256-bit token**. Only its **SHA-256 hash** is stored. It **expires in 7 days**, is **single-use**, and is **bound to that email**.
   - The app shows the invite link `https://bdgtr.erroldee.com/invite/<token>` and opens the **native share sheet** (Messenger, Viber, SMS, email). No email service is needed in v1. Sending emails through **Resend's free tier** is a v2 option once your domain is verified.
3. **Accept:**
   - The link opens the **Android app** if it's installed. Android App Links use `/.well-known/assetlinks.json`, which Cloudflare Pages serves. Otherwise it opens the **web app**.
   - The user signs in. The API checks the token hash, expiry, that it hasn't been used, and that **the user's verified email matches the invite**, so a forwarded link is useless.
   - The API then creates the membership, marks the invite used, and switches the user to that household.
4. **Multiple households:** a switcher in the header or side rail shows the household name with a ▾. "Join another household" accepts an invite. "Create household" starts a new one.
5. **Leave / remove:**
   - Co-Owners and House Members can leave. The House Owner or a Co-Owner can remove them, and access ends on their next request.
   - The **House Owner can't leave** until they transfer ownership or delete the household.
   - A removed member's past transactions stay, still showing who entered them.
6. **Delete household** (House Owner only): type the household name to confirm. It's soft-deleted, then purged after 30 days.

### New screen: Household & Members (under More)
- Household name (editable by the House Owner and Co-Owners) and currency (PHP, fixed for now)
- **Members list**: name, email, role badge, joined date. The House Owner is always listed first, with a crown badge plus the text "House Owner".
  - **Owner and Co-Owner actions:** change role (Co-Owner ↔ House Member) and remove, available on every row **except the House Owner's**
  - **House Owner only:** transfer ownership
- **House Members** see the list read-only, plus their own "Leave household"
- **Pending invites**: email, role, expiry. Actions: copy/share link again, revoke.
- **Invite member** button, then the invite sheet
- **Leave household** (destructive, asks for confirmation)

---

## 4. Data model (MongoDB collections)

Amounts are `amountMinor: int` in **centavos** (₱1.00 = 100). Household-owned documents carry `householdId`, `createdAt`, `updatedAt` and `createdBy` (userId).

| Collection | Key fields | Indexes |
|---|---|---|
| `users` | clerkUserId, email (verified), displayName, `lastHouseholdId` | unique(clerkUserId) |
| `pushSubscriptions` | userId, `kind: expo/webpush`, `expoToken?` or `{endpoint, keys.p256dh, keys.auth}?`, deviceLabel, lastSeenAt | unique(endpoint / expoToken), (userId) |
| `households` | name, `currency: "PHP"`, `timezone: "Asia/Manila"`, `defaultMonthlyBudgetMinor`, `deletedAt?` | — |
| `memberships` | householdId, userId, `role: owner/co_owner/member`, `status: active/removed/left`, joinedAt, `alertsMuted`, `dailyDigestEnabled` (both per household, so a user can mute one household and not another) | **unique(householdId, userId)**, (userId, status), **partial unique(householdId) where role = owner and status = active**, which guarantees exactly one House Owner |
| `invites` | householdId, email, role, `tokenHash`, expiresAt, `status: pending/accepted/revoked/expired`, invitedBy | unique(tokenHash), (householdId, status), TTL cleanup |
| `categories` | name, icon, colour, `defaultBudgetMinor`, `isRemoved`, `removedAt` | unique(householdId, nameLower) where not removed |
| `monthlyBudgets` | `yearMonth: "2026-11"`, `totalBudgetMinor` (override only) | unique(householdId, yearMonth) |
| `categoryBudgets` | yearMonth, categoryId, `budgetMinor` (override only) | unique(householdId, yearMonth, categoryId) |
| `transactions` | `clientId` (UUID generated by the app), `date` (calendar date), yearMonth, categoryId, amountMinor, description?, `source: manual/fixed-auto/fixed-bulk`, `fixedTransactionId?`, `enteredAt` (device time), `syncedAt` (server time) | (householdId, yearMonth, date), (householdId, yearMonth, categoryId), **unique(householdId, clientId)**, so a retried save never creates a duplicate (offline groundwork) |
| `digestLog` | householdId, `forDate` (the "yesterday" date), sentAt, recipients count | **unique(householdId, forDate)**: a retried 7 AM run never double-sends |
| `fixedTransactions` | name, categoryId, amountMinor, description?, `dayOfMonth 1–31`, `autoPostEnabled`, `isRemoved` | (householdId) |
| `fixedPostings` | fixedTransactionId, yearMonth, transactionId | **unique(fixedTransactionId, yearMonth)**: makes auto-post idempotent |
| `alerts` | householdId, yearMonth, scope (`total`/categoryId), `level: near/over`, triggeredBy, createdAt | unique(householdId, yearMonth, scope, level): one alert per crossing |

**Effective-budget resolution** (pure functions in `shared`):
- `totalBudget(month) = monthlyBudgets[month] ?? household.defaultMonthlyBudget`
- `categoryBudget(month, cat) = categoryBudgets[month, cat] ?? category.defaultBudget`, except the built-in **Unbudgeted** category: `max(0, totalBudget − Σ the other active categories' budgets)` (§6.4)
- `unallocated(month) = totalBudget − Σ categoryBudget` (Unbudgeted not counted, so when positive it equals Unbudgeted's budget). A negative value means over-allocated, which shows a warning.
- `remaining(month) = totalBudget − Σ transactions(month)`

Overrides are stored only when they differ from the default, so editing a default flows into every month that has no override.

**Soft delete:** categories and fixed transactions are marked removed, never deleted, so past transactions still resolve. Individual transactions are hard-deleted after confirmation.

---

## 5. API surface (v1)

All routes need a Clerk JWT. Household-scoped routes also need `X-Household-Id` plus an active membership.

```
# Account & households (no X-Household-Id)
GET    /me                                   → user + memberships list
POST   /households                           → create, caller becomes owner
POST   /invites/accept                       { token }

# Household-scoped
Role keys: [O] House Owner · [C] Co-Owner · [M] House Member

GET    /household [OCM]      PATCH /household [OC]      DELETE /household [O]
GET    /members [OCM]
PATCH  /members/:userId [OC]                role co_owner ↔ member; target must not be the House Owner
DELETE /members/:userId [OC], or self       remove; target must not be the House Owner; self = leave
POST   /members/transfer-ownership [O]
GET    /invites [OC]  POST /invites [OC]  DELETE /invites/:id [OC]

GET    /dashboard?month=YYYY-MM [OCM]
GET    /transactions?month= [OCM]          the whole month, unfiltered (built in M4): the app filters,
                                             sorts and pins on the device, so no filter/sort params
POST   /transactions [OCM]                   { clientId, … } → { transaction, alerts[] }
                                             same clientId again → 200 with the original (idempotent)
PATCH  /transactions/:id  DELETE /transactions/:id   [OC] any · [M] own only (else 403)
GET    /categories [OCM]                     POST/PATCH/DELETE [OC] (DELETE = soft remove; POST /:id/restore)
GET    /fixed-transactions?month= [OCM]      active items + postedOn (first add that month) · POST/PATCH/DELETE [OC]
POST   /fixed-transactions/bulk-post [OC]    { date, items: [{ id, clientId }] } (built in M5a): each item's own
                                             clientId makes a retry safe; the app asks before re-adding
GET    /budgets?month= [OCM]                 the month's total and active categories: defaults, overrides, allocation
PUT/DELETE /budgets/monthly/:yearMonth [OC]                    { budgetMinor } · DELETE = reset to default
PUT/DELETE /budgets/categories/:yearMonth/:categoryId [OC]     { budgetMinor } · DELETE = reset to default
       (built in M3) Defaults are edited where they live: PATCH /household (monthly) and
       PATCH /categories/:id (per category). Setting a month to the default's own value
       stores no override. Every change answers with the month's budgets.
GET    /alerts?month= [OCM]                   budget alerts + fixed notices (kind); House Members don't get managers-only ones
PATCH  /membership/me [OCM]                  { alertsMuted, dailyDigestEnabled }

# Device push registration (no X-Household-Id)
POST   /push-subscriptions                   { kind, expoToken | webPushSubscription, deviceLabel }
GET    /push-subscriptions                   DELETE /push-subscriptions/:id   (own devices only)
GET    /push/vapid-public-key

# Internal
POST   /internal/cron/fixed-postings         (Authorization: Bearer CRON_SECRET) 00:15 Manila
POST   /internal/cron/fixed-notices          (Authorization: Bearer CRON_SECRET) 07:00 Manila
POST   /internal/cron/daily-digest           (Authorization: Bearer CRON_SECRET) 07:00 Manila; optional { date } = the morning to run for (last 7 days)
```

---

## 6. Screens & behaviour

### Navigation
- **Phones and folded Fold 6 (< 600dp):** bottom tabs **Home · Spend · Alerts · More**, as in the template, plus a floating **+** button.
- **Unfolded Fold 6, tablets and desktop web (≥ 600dp):** a **side navigation rail** with the same items plus the household switcher. **+ Add spend** sits as a primary button at the top of the rail.
- **More** contains: Budgets, Categories, Fixed Transactions, Household & Members, Settings (enable notifications on this device, mute alerts and toggle the daily 7 AM summary for this household, my devices, sign out). House Members see Budgets, Categories and Fixed Transactions read-only.

### 6.1 Welcome / sign-in (template screen 1)
Gradient-arc hero, "Get Started", Google sign-in, then one of: create a household, accept a pending invite, or pick a household.

### 6.2 Dashboard (template screen 2)
- "Hi, {name}", household name and the month
- **Total budget** (e.g. **₱69,420.00**) and **Remaining**. When over budget, Remaining shows **bold, red `#FF6B6B`, a ⚠ icon and the text "Over by ₱X"**. Colour is never the only signal.
- **Budget / Spent** tiles, where the template has Income / Outcome
- **Bar chart: Spent vs Remaining per category** (stacked horizontal bars), with a "View as table" alternative
- Quick actions: **+ Add spend** and **View breakdown** (current month)

### 6.3 Transaction Entry (modal on phones, side panel on wide screens)
- Date: **Today / Yesterday / Pick date** (native picker on Android, `<input type="date">` on web)
- Category: grid of chips, most-used first. **House Owners and Co-Owners also get "+ New category"**: it asks only for a name and adds the category with a "?" icon, a neutral colour and no budget (edit them later in Categories), then selects it. A name that already exists just selects that category.
- Amount: numeric keypad opens with autofocus, ₱ prefix, centavos allowed
- Description: optional, collapsed by default
- After saving, the API works out threshold crossings, saves `alerts` and **fans them out to every active household member's registered devices** (Android push plus browser Web Push), skipping members who muted this household. The person who entered the spend also sees an in-app toast straight away. Delivery rules are in §2b.

**Threshold rule** (pure function, heavily tested):
> For the transaction's category and for the household total: reaching 90% or more fires **"near"**; going above 100% fires **"over"**. **For a category, every new spend while it's at 90% or more sends its current alert again** ("near" or "over", with the updated percentage or amount; a repeated "over" is titled "Still over budget · {category}"). **The household total fires each level once a month** (a unique index enforces the first alert per crossing). A spend that jumps past both sends only "over", and a budget of zero or no budget never fires.
>
> The check is "what level has spending reached, and has this household had that alert yet this month?" rather than "did this one spend cross the line?", so simultaneous spends that only together cross a line still produce exactly one alert. Only new spends set off alerts (not edits or deletes).

### 6.4 Categories
Add, edit (name, icon, colour, default budget) and remove, with confirmation explaining that past transactions keep the category. A "Show removed" toggle allows restore.

**The built-in "Unbudgeted" category (owner's decision after M6; it replaced the default "Groceries"):**
- Every household has exactly one (`kind: 'unbudgeted'`, "⋯" icon, **red** `#FF6B6B`, the owner's choice; older ones are switched to red at start-up). New households start with only this. Older households get it added the next time they're opened, and their existing categories (e.g. Groceries) stay as normal ones. An existing active category named "Unbudgeted" becomes the built-in one rather than a duplicate. A partial unique index allows one active per household.
- It **can't be removed, renamed or recoloured** (409 `protected_category`); only its icon can change. The app shows "Built in…" instead of Edit/Remove.
- **Its budget is automatic:** the month's total minus the other active categories' budgets, never below ₱0 (`unbudgetedMinor` in shared). It can't be set by hand: its default (409 `protected_category`) and its month budget (409 `automatic_budget`) are both refused.
- The same number is used by Budget per Category (listed last, "Automatic"), the dashboard and the budget alerts. On Budget per Category the unallocated rest is drawn as its slice and worded "₱X in Unbudgeted".
- Spends can be recorded in it like any category.
- Because it always exists, a household can never run out of categories. The old "last category can't be removed" rule is now never reached.

### 6.5 Monthly Fixed Transactions
**As built (M5a):** More → Fixed transactions (`src/fixed/`, route `/fixed`).
- Each item shows its name, amount, category and day ("Every month on the 5th"; days 29–31 add "or the last day of shorter months"), whether it's added automatically or by hand, and when it was added this month.
- **Auto-post** is `POST /internal/cron/fixed-postings` (Bearer `CRON_SECRET`, constant-time check; 503 when the secret isn't set). It adds the items due on today's **Manila** date in every household, and an optional `{ date }` re-runs one of the last 7 days.
- **No double-posting:** each auto-post uses a fixed clientId for that item and month (a UUID made from a hash of the two), so a re-run, or a crash between adding the spend and noting it in `fixedPostings`, never adds it twice. Items already added that month (by bulk add) are skipped, and so are items whose category was removed; the app marks those in red.
- **Alerts:** spends added these ways raise budget alerts like any spend. Auto-posted ones are recorded as entered by the person who created the item.
- **Bulk add:** "Select to add", tick items, pick a date (its month drives the "already added" flags), then "Add N transactions". If any were already added that month, a dialog offers **Skip them** (only when some aren't repeats), **Add again** or **Cancel**.
- Removing an item is a soft remove, and spends already added from it stay.
- **7:00 AM notices** (`POST /internal/cron/fixed-notices`, same secret, called by the 07:00 Worker run with the daily summary; chosen over 00:15 so phones don't buzz at midnight):
  - **Added automatically** → the whole household: "Dela Cruz household: Rent (₱15,000, Housing) was added as today's spend."
  - **Due today**, for items *not* added automatically that fall due today and haven't been added this month → **House Owner and Co-Owners only** (`audience: 'managers'`; House Members don't see it in Alerts or get the push): "… is due today. Add it in Fixed transactions."
  - **"Add it now"** on a due-today reminder in the Alerts tab adds the item as a spend on its due day with one tap (the bulk-add call for that one item). The API decides when it shows (`canAdd`): only for the House Owner and Co-Owners, only on the due day in Manila, only while the item hasn't been added that month (by any route) and still exists. A retry reuses the same clientId, so it can't add twice.
  - Both are stored in the Alerts tab (`kind: fixed_added | fixed_due`, with their own icons) and pushed like budget alerts. Muted members get no push. One per item, day and kind, so re-runs send nothing new. Notices use level `near` (neutral) so app builds from before `kind` existed still read them.
- The add/edit form has the same **"+ New category"** quick add as Add spend: it asks only for a name, and an existing name just selects that category.
- House Members see the list read-only.
- CRUD list: name, category, amount, day of month, auto-post toggle
- **Auto-post**: the daily cron posts every enabled item whose day matches today in Manila time. Days 29–31 clamp to the last day of the month. The unique index on `fixedPostings` prevents duplicates.
- **Bulk add**: tap "Select", tick items, choose a date, then "Add N transactions". Items already posted this month are flagged, and the user can skip them or post again.

### 6.6 Budget Allocation for the Month
Month switcher. Shows the default monthly budget (editable) and this month's value, with a "Custom" badge and "Reset to default" when overridden. Link to **Budget per Category →**.

### 6.7 Budget per Category (template screen 3)
- Month switcher at the top; the labels below don't repeat the month
- Donut showing the % of the month's total allocated and the **unallocated balance** (red plus icon if over-allocated)
- Rows show each category's budget for the month, a "Custom" badge and "Reset to default"
- Category defaults aren't shown or edited here; they live under More → Categories

### 6.8 Monthly Spend Breakdown
**As built (M4):** the Spend tab (`src/breakdown/`). The month's spends are fetched whole and arranged on the device by `arrangeBreakdown` in `shared/breakdown.ts`, which filters, sorts with stable id tie-breaks, and puts pinned rows first. Pins are stored as `{ transactionId: "YYYY-MM" }` under `pins:<clerkUserId>:<householdId>` with AsyncStorage, which uses localStorage on the web. `prunePins` drops a month's pins whose spend is gone each time that month loads. Sign-out removes every `pins:` key. Filters apply as you change them; an invalid range shows its error and is ignored. The month picker opens from the month name in `MonthSwitcher`, so Budgets and Alerts have it too. Filter and Sort are separate icon buttons at the right end of the count/total line, and each opens its own panel (one at a time). The filter button shows a number badge when filters are on.
- Month selector, defaulting to the current month, with ‹ › arrows and a month picker
- Filters: category multi-select and a min–max ₱ range (min ≤ max is validated). Combined with AND.
- Sort: date or cost, ascending or descending. **The member's own pinned rows always come first**, with filters still applied to them.
- **Pins are stored on the device only:**
  - Android uses AsyncStorage and web uses `localStorage`, keyed by `pins:<userId>:<householdId>` and holding a set of transaction IDs. The API never receives pins.
  - Pins don't sync between a member's devices, and reinstalling or clearing browser data loses them. That's acceptable because pins aren't critical.
  - Pin IDs for transactions that no longer exist are pruned when the month loads. All pin keys for the user are cleared on sign-out, so a shared computer doesn't keep them.
  - Since pinning is applied on the device, the month's filtered list is fetched **whole, without pagination**. A household month is a few hundred rows at most. Pinned-first ordering is a pure function in `shared`.
- Each row shows **Date · Category · Cost**, then a **Pin** icon button and a **Delete** icon button at the right end. These were changed after M4 at the user's request: no "⋯" menu, no long-press or right-click menu, and **no swipe gestures**. The date stays on one line.
- Tap a row to open a dialog with its description, or "No description"
- **Editing saved spends (added after M6):** the description dialog has **Edit** for spends the person may change. House Members can edit their own; the House Owner and Co-Owners any (D1). It opens Add spend filled in (`/add?edit=<id>&month=`), and saving sends `PATCH /transactions/:id`. If the spend's category was removed since, it stays offered while editing.
  - An edit checks the budget thresholds again, like a new spend: the reply includes any new alerts, which are shown as toasts and pushed to members.
- **Pin icon** toggles the pin, with no confirmation. **Delete icon** asks for confirmation first. There are **no swipe gestures** on rows; both swipes were removed at the user's request.
- **House Members** see the Delete icon only on rows they entered. Other rows keep an empty slot so the columns line up. Pinning works for everyone.
- Every icon button has a full spoken label, e.g. "Delete Nov 3, Groceries, ₱500.00", and a 48dp target.

### 6.9 Household & Members
See §3.

### 6.10 Alerts
**Kept 7 days (changed after M5b, to save database space):**
- Every alert is deleted by MongoDB 7 days after it's made (TTL index `ttl_7_days` on `alerts.createdAt`). That covers budget alerts, daily summaries and fixed-transaction notices.
- The Alerts tab lists **the last 7 days** (`GET /alerts` with no month) with no month switcher. `?month=` still works for app builds from before this change.
- "Already alerted this month" now lives in a tiny `alertCrossings` record per household, month, scope and level (unique; deleted after 70 days). So when a budget alert is deleted after a week, the monthly-budget "over" alert still doesn't fire a second time that month, and a category's further spends still say "Still over budget". Budget alerts that existed before this change were copied in at start-up.
Monthly list of budget alerts: who triggered each one, the category, and the level. An unread badge sits on the tab. This is the durable record behind every push and toast.

### 6.11 Daily 7:00 AM summary notification
**As built (M5b):**
- `POST /internal/cron/daily-digest`, called at 07:00 Manila by the scheduler Worker (`apps/scheduler`), sends one summary per household that has active members. The text comes from `formatDailySummary` in `shared/digest.ts`.
- It's stored once in the Alerts tab (`kind: daily_summary`), listed under the month it arrives, and is idempotent through the alerts unique index (scope `daily_summary:<yesterday>`). That replaces a separate `digestLog`.
- It's pushed to members with the **Daily 7 AM summary** switch on (Settings, per household, on by default). That switch is separate from muting: a muted member still gets the summary. The push uses tag `digest-<household>`, so today's replaces yesterday's.
- Over budget sends level `over`, which is high priority.
Every day at **7:00 AM Manila time**, each active member of each household gets one notification per household, unless they've turned the daily summary off for that household.

The message is about the **whole household's** spending, not the person reading it. It always follows this pattern:
`Yesterday {Household name} household spent {₱x}. …`

**Example (normal day):**
> **Daily summary · Dela Cruz household**
> Yesterday (Sun, 22 Nov) Dela Cruz household spent **₱1,845.50**. **₱12,310.25 left** of ₱40,000.00 for November.

**Example (over budget):**
> Yesterday (Sun, 22 Nov) Dela Cruz household spent **₱3,200.00**. **Over budget by ₱1,150.00** for November.

**Example (₱0 day, D4):**
> Yesterday (Sun, 22 Nov) Dela Cruz household had no spending recorded. **₱12,310.25 left** of ₱40,000.00 for November.

**Example (1st of the month, D3):**
> Yesterday (Mon, 30 Nov) Dela Cruz household spent **₱950.00**. **November closed ₱2,400.00 under budget.** December budget: ₱40,000.00.

**Name handling:**
- If the household name already ends in "household" (e.g. "Dela Cruz Household"), the word isn't added again, so it never reads "Dela Cruz Household household".
- Names are capped at 40 characters, so the amount stays visible in the collapsed notification.
- The message text is built by one pure function in `shared` (`formatDailySummary`), which is unit-tested for each example above.

**Computation** (pure function in `shared`, run by `/internal/cron/daily-digest`):
- `yesterday` = today's date in **Asia/Manila** minus one day. The cron fires at 23:00 UTC, so the code must never use the server's UTC date.
- `yesterdaySpend` = Σ transactions in the household dated `yesterday`, from **all members**
- `remaining` = month budget − Σ transactions for the current month **as of the run time**. That includes anything auto-posted at 00:15 today, such as rent due on the 23rd.
- Over budget switches the wording to "Over budget by ₱X", and the alert is marked high priority
- A ₱0 day still sends "No spending recorded yesterday" (D4)

**Delivery:**
- Same fan-out as threshold alerts (§2b): Android push and Web Push to every registered device of every member who has it enabled
- Also stored in the **Alerts** tab as a "Daily summary" entry
- Idempotent through `digestLog`, so a retried cron run doesn't double-send
- A user in three households gets three notifications, each titled with its household name

**Settings:** a "Daily 7 AM summary" toggle per household, on by default, kept separate from the threshold-alert mute.

### 6.12 In-app toast ("growl")
- Appears top-right on wide screens and as a top banner on phones. It never covers the FAB or tab bar (WCAG 2.4.11).
- Stays until dismissed or for **at least 10 seconds**, pausing on hover or focus (WCAG 2.2.1). It has a close button and a "View" link.
- Uses `role="status"` / `aria-live="polite"` for "near" and `role="alert"` for "over", so screen readers announce it
- Also appears when another member's spend triggers an alert while this member has the app open. The foreground push is shown as a toast instead of a duplicate system notification.

---

## 7. Design system (from the template)

| Token | Value | Notes |
|---|---|---|
| `bg` | `#12152B` | |
| `surface` / `surfaceRaised` | `#1B1F3A` / `#242949` | |
| `primary` | `#5A94FF` → `#7FB8FF` gradient | The template's `#4F8CFF` is 4.39:1 on `surfaceRaised`, so it was nudged lighter to pass 4.5:1 |
| `textPrimary` / `textSecondary` | `#FFFFFF` / `#A9B0D0` | Secondary is lightened from the template's grey so it meets 4.5:1 |
| `success` / `danger` | `#4ADE80` / `#FF6B6B` | Both 4.5:1 or better on `bg` and `surface` |
| Fonts | Poppins (headings), Inter (body) | |
| Money | `Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })` → ₱1,234.50 | Single helper in `shared` |

v1 ships dark mode only, matching the template.

---

## 8. Responsive layout: foldables, phones & desktop web

| Target | Width (dp/px) | Layout |
|---|---|---|
| Fold 6 cover screen | ~360–375 | compact |
| Galaxy S24 FE | ~384–412 | compact |
| Fold 6 unfolded, portrait | ~700 | medium: side rail, single pane |
| Fold 6 unfolded, landscape / tablet | ~820 | medium: side rail, single pane |
| Large tablet | ≥ 840 | expanded: side rail, two panes |
| Desktop browser | ≥ 1024 | expanded, content capped at about 1200 px wide |

- Material 3 window size classes from `useWindowDimensions()`: compact < 600, medium 600–839, expanded ≥ 840. **The side rail starts at medium (600dp)**, as Material 3 recommends. The unfolded Fold 6 is about 700dp wide (1856px at Android's ~2.6× scaling), so it never reaches 840; an earlier 840dp threshold left it on bottom tabs. Layout reacts live to folding, unfolding and browser resizing without losing state.
- **No two-pane layouts (decided after M6b):** every screen keeps its single-column layout at every width. The content column is capped at about 1200 px, and the side rail starts at medium. Two-pane versions were built (#44) and removed again (#46), because some views broke in the narrower panes (e.g. the dashboard chart's table view), and the single column reads better.
- Keep important controls away from the hinge. Content must reflow at 200% font size and at 320 CSS px wide on web (WCAG 1.4.4, 1.4.10).
- **Test matrix:** Android Studio's Fold and 7.6" foldable emulators, a 6.7" phone profile, a real device where possible, Chrome and Firefox desktop at 100% and 200% zoom, and Chrome Android.

---

## 9. Accessibility (WCAG 2.2 AA)

- Contrast: 4.5:1 for text and 3:1 for UI components and chart bars, checked by a token unit test
- Targets ≥ 48×48 dp (2.5.8 needs only 24×24)
- `accessibilityRole`, `accessibilityLabel` and `accessibilityState` on everything interactive. These become ARIA attributes on web through react-native-web. Amounts are read as "Remaining: minus 1,200 pesos, over budget".
- Text or table alternatives for charts (1.1.1)
- Swipe and drag actions all have single-pointer and keyboard alternatives (2.5.1, 2.5.7)
- **Web keyboard support:**
  - Full Tab, Enter, Space and Escape operation
  - Visible focus rings (2.4.7) that sticky bars and the FAB never hide (2.4.11)
  - A skip-to-content link
  - Modals trap focus and return it when closed
- Status messages are announced (4.1.3). Form errors show as text (3.3.1). Previously entered data isn't asked for again (3.3.7).
- Google SSO avoids cognitive tests at sign-in (3.3.8). Invite links avoid code-typing.
- Respect reduced-motion settings (`prefers-reduced-motion` on web)
- **Tooling:**
  - `eslint-plugin-react-native-a11y`
  - React Native Testing Library role queries
  - **axe-core through Playwright** in CI (built in M6b, `apps/mobile/e2e/`): WCAG 2.2 AA rules on every page that renders signed out (sign-in, privacy, terms, invite, 404), plus a real-keyboard check of the skip link. Signed-in screens need a Clerk session in CI, so for now they're covered by role-based component tests and the manual passes.
  - **Skip to content** link (web) and **reduced motion** for dialogs (built in M6b)
  - Manual TalkBack and NVDA passes each milestone

---

## 10. Security & secrets

**Where each secret lives:**

| Secret | Location | Never in |
|---|---|---|
| Atlas connection string | Vercel env var (encrypted), local `apps/api/.env` (git-ignored) | app bundle, git |
| Clerk **secret** key | Vercel env var | app bundle, git |
| Google OAuth **client secret** | Inside the Clerk dashboard only | anywhere in our code |
| Expo push access token, `CRON_SECRET`, **VAPID private key** | Vercel env vars | app bundle, git |
| VAPID **public** key | Served by `/push/vapid-public-key` | — (public by design) |
| Android upload keystore | EAS credentials | git |

**Public by design** (safe in `EXPO_PUBLIC_*`): the Clerk publishable key, the API base URL and the Google OAuth client ID. Native and web OAuth use PKCE, so a client secret is never on the device. **gitleaks** runs as a pre-commit hook and in CI.

**API hardening (OWASP API Top 10):**
- Membership check on every household-scoped request. Every query filters by `householdId` and object IDs are never trusted alone, which prevents BOLA/IDOR.
- Every route declares its minimum role (§5) and the server enforces it; hiding controls in the UI is only cosmetic. A dedicated guard rejects any change targeting the House Owner's membership unless it's the Owner acting on themselves, and a partial unique index guarantees exactly one House Owner per household.
- Strict Zod `.strict()` schemas reject unknown keys and `$`-prefixed operators, blocking NoSQL injection
- Invite tokens: 256-bit random values, stored as hashes, single-use, 7-day expiry, bound to an email, rate-limited on accept (10 failures per person per 15 minutes → 429). "Share again" issues a fresh token and revokes the old one, because the original can't be recovered from its hash.

**Clerk session token claims** (Clerk dashboard → Sessions → Customize session token), read by the API:
- `"email": "{{user.primary_email_address}}"`: required for invites (an invite is only accepted by the email it was sent to). Clerk only makes an email primary once it's verified.
- `"name": "{{user.full_name}}"`: optional. Shows people's names in the members list; without it, the list shows emails.
- **CORS** allows only `https://bdgtr.erroldee.com` (and localhost in dev)
- Rate limiting, secure headers, body size limits, generic error responses. **Rate limits (built in M6a):** per person (Clerk user), counted in MongoDB in fixed 5-minute windows (`rateLimits`, TTL cleanup), because Vercel instances share no memory: 120 changes and 1,200 reads per window, then **429** with `Retry-After`. Far above real use. On in `index.ts`/`server.ts` (`rateLimit: true`); tests opt in. Accepting invites keeps its own stricter limit.
- The cron endpoints require `CRON_SECRET`, compared in constant time

**Web hardening:** a Cloudflare Pages `_headers` file sets:
- a strict **Content-Security-Policy** (self, Clerk, `bdgtr-api.erroldee.com` only)
- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `frame-ancestors 'none'` against clickjacking
- `worker-src 'self'`, so only our own service worker can register. The worker is served with `Cache-Control: no-cache` so updates ship immediately.
- `Permissions-Policy`

Clerk handles web sessions with short-lived tokens. We store nothing sensitive in `localStorage`.

**Android hardening (OWASP MASVS):** tokens kept in secure-store, `allowBackup=false`, HTTPS only, no PII in logs, R8-minified release builds.

**Atlas:**
- Dedicated user with `readWrite` on `bdgtr` only, a long random password, and MFA on the Atlas account
- Vercel's outbound IPs are dynamic, so **the network allowlist must be `0.0.0.0/0`**. Mitigations: the credential exists only in Vercel, TLS is enforced, and the user's privileges are minimal. If a fixed IP becomes necessary, move to a paid host or a static-egress proxy.
- **Backups (built in M6a, docs/BACKUPS.md):** M0 has no automated backups, so `.github/workflows/backup.yml` runs `mongodump` every Sunday 03:00 Manila as a **read-only** Atlas user (`BACKUP_MONGODB_URI` secret). It encrypts the dump with the owner's **age public key** (`.github/backup-age-recipient.txt`) and keeps it as a 90-day workflow artifact. The repo is public, so only the encrypted file is ever uploaded, and the private key stays on the owner's computer.

**Supply chain:** lockfile, **Dependabot** (`.github/dependabot.yml`, built in M6a: weekly on Monday, grouped minor/patch updates for npm and GitHub Actions; Expo/React Native packages are left out because they move together with the Expo SDK, via `npx expo install --fix`), and `pnpm audit` in CI that fails on high or critical findings.

---

## 11. Testing strategy

| Layer | Tool | Focus |
|---|---|---|
| Shared logic | Vitest | budget resolution, thresholds, date clamping, filter/sort/pin ordering, PHP formatting, daily-summary computation, role→permission matrix |
| API | Vitest + Hono's built-in test client (`app.request`) + `mongodb-memory-server` | routes, auth, membership and role checks (whole §3 matrix, table-driven), validation, invites, cron idempotency |
| Device storage | Jest (`jest-expo`) with mocked AsyncStorage / `localStorage` | pin store per user and household, pruning, clearing on sign-out, Zod validation of stored values (corrupt → default), storage version migration, no token or secret ever written |
| UI components | Jest (`jest-expo`) + React Native Testing Library + `expo-router/testing-library` | forms, lists, accessibility roles and labels |
| Web E2E + a11y | Playwright + axe-core | main flows and zero axe violations |
| Android E2E | Maestro | main flows on the phone and foldable emulator profiles |

**Coverage targets:** shared ≥ 90%, API ≥ 85% (branches ≥ 80%), app ≥ 85% (see "Coverage is enforced" below).

**Every bug gets a regression test (standing rule).** When testing finds a bug:
1. First write a test that reproduces it through the same path the user took (e.g. render the real screens, not just a helper), and run it against the unfixed code to confirm it **fails**.
2. Fix the bug; the test must now pass. Also add tests for the nearby edge cases the fix touches.
3. Name the test after the user-visible symptom, add a `Regression:` comment saying what went wrong, and list it in the table below.

| Found | Symptom | Regression tests |
|---|---|---|
| M1b | Dashboard kept the old monthly budget after it was changed under More → Household (each screen held its own copy of the household details) | `apps/mobile/src/household/__tests__/household-details-sync-test.tsx`, `use-active-household-test.tsx` |
| M1b audit | Deleted households still counted toward the 20-household limit, so creating and deleting test households eventually locked a person out | `apps/api/src/households.test.ts` ("deleted households do not count toward the limit") |
| M1b audit | Household screen showed one vague budget error ("Enter an amount like…") for every mistake, unlike Create household | `household-screen-test.tsx` (specific messages) |
| M1b audit | A failed sign-out did nothing and showed nothing | `household-switcher-test.tsx` (More screen) |
| M1b prod | Android sign-in only said "Sign-in didn't complete" when Clerk rejected the app's return link (`resource_missmatch`), so the cause had to be found by hand. Now Clerk's reason code is shown | `apps/mobile/src/components/__tests__/sign-in-test.tsx` |
| M1a prod | Web CSP blocked Clerk Protect, then its probe hosts, and new sign-ups were rejected (PRs #8, #9); a custom `+html.tsx` once shipped pages without their JavaScript | `apps/mobile/scripts/__tests__/write-web-headers-test.ts` |
| M1c | Opening or refreshing `/household` (also `/add`, "Create another household") straight from its URL left no way out: no history, so no header back button and Cancel did nothing. Now Back/Cancel go to the dashboard when there's no history | `apps/mobile/src/components/__tests__/back-navigation-test.tsx` (real root layout) |
| M2b dev | Simultaneous spends that only together crossed 90% sent no alert (each saw the others as "already there"). Now the level reached is judged | `apps/api/src/alerts.test.ts` ("simultaneous spends…") |
| M2b-3 PR | The Vercel preview failed to build (TS2339: no `.ok`/`.json` on fetch's `Response`): Vercel's build doesn't see the global fetch types, though local checks did. API code now describes the fetch it uses (`FetchLike`) | `apps/api/scripts/verify-deploy-build.mjs` (`pnpm --filter @bdgtr/api verify:deploy`, in CI) fails on API source using `typeof fetch` / `RequestInit` |
| M5a dev | On the fixed-transaction form, a field's error stayed after you corrected it, so its hint (e.g. "Every month on the 12th") stayed hidden until the next Save | `apps/mobile/src/fixed/__tests__/fixed-screen-test.tsx` ("a corrected field drops its error") |
| M5b CI | CI on `main` failed at random: with no cached MongoDB test binary, several API test files downloaded it at once and raced over its lock file (`UnableToUnlockLockfileError`) | `apps/api/vitest.global-setup.ts` downloads it once before any file starts; verified by running the suite with an empty binary cache |
| M6b CI | The website's "Skip to content" link could be reached with Tab but **Enter did nothing**: react-native-web only fires `onPress` for clicks on a `role="link"` with no `href`. Now Enter and Space activate it | `apps/mobile/src/components/__tests__/skip-to-content-test.tsx` (keyboard), `apps/mobile/e2e/a11y.spec.ts` (real browser: Tab then Enter moves focus to the content) |
| Offline dev | After the server refused a queued spend (e.g. 403), the banner still said "You're offline": only successful sends cleared it, though any answer proves the connection works | `apps/mobile/src/offline/__tests__/outbox-test.tsx` ("refused … Retry resends, Discard drops") |
| M6 CI | CI on `main` failed at random again: two API test files started their own MongoDB at once and picked the same free port (`Port … already in use`) | `apps/api/vitest.global-setup.ts` now starts **one** shared test MongoDB (single-node replica set) for every file; each file keeps its own database (`src/test-utils/mongo.ts`). Run cold and repeatedly |
| Offline, on the phone | Starting the Android app in airplane mode showed only a spinner. Clerk couldn't restore the session without a connection, and the household list (`/me`) was always fetched from the server. Now Clerk's experimental `__experimental_resourceCache` is on (Android only), `/me` is kept in the encrypted offline store per person, and a request with no token is still sent, so offline reads as offline rather than "signed out" | `apps/mobile/src/household/__tests__/household-context-test.tsx` ("offline start…"), `src/lib/__tests__/api-test.ts` ("no token and no connection…") |
| Offline, on the phone (2nd test) | In airplane mode Add spend sat on a spinner for minutes, then said "Couldn't load the categories", and Try again did nothing. Clerk's `getToken` keeps retrying offline, and categories were only saved once Add spend had been opened online. Now the phone's connection status (NetInfo) fails requests at once, a token wait gives up after 8 s, the offline essentials are saved whenever the app is online, and Try again visibly retries with an offline-specific message | `apps/mobile/src/offline/__tests__/network-test.tsx` ("fails at once…", "gives up on a token…", "connection status"), `offline-warmup-test.tsx` |
| Offline, on the phone (2nd test) | Spends, Alerts and the More screens only spun offline. Spends and Alerts now load their saved copies at once; Household, Categories, Fixed transactions, Settings and Sign out are disabled with "Needs a connection" while offline and come back when the connection does | `network-test.tsx` ("More tab offline…") |
| Phone sign-in | After Google sign-in, "page not found" flashed for about 2 s: the return link `bdgtr://sso-callback` had no screen. Now it shows a quiet spinner and goes home once signed in (back to sign-in after 15 s if it never finishes) | `network-test.tsx` ("sign-in return link…") |

**Coverage is enforced:** `pnpm test` (and so `pnpm check` and CI) fails if coverage drops below: shared 90%; API 85% (branches 80%); app 85% statements/lines, 80% branches, 75% functions, counted over **every** app file, not only the ones a test touches.

**Writing app (Jest) tests:**
- API tests share **one** MongoDB started by `apps/api/vitest.global-setup.ts` (a single-node replica set, so transactions work). Each test file connects with `sharedMongo()` and uses its own database name. Per-file servers raced over the binary download and over free ports, and filled a small `/tmp`.
- Made-up tokens and keys in tests should look fake (e.g. `'x'.repeat(24)`): realistic random-looking strings trip the CI secret scan.
- Mocked hooks must return the **same** functions and objects on every render, like the real ones (Clerk's `useAuth`, `useFetchMe`). A new function per render makes effects refetch forever and the test hangs.
- `getByRole` only finds elements that are accessible to screen readers: a plain `View` with `role="list"` or `role="dialog"` isn't, so find those by their visible text (or wait for the loading indicator to go).
- If `tsc` complains that a new route like `"/fixed"` isn't a valid `Href`, the dev server's generated `.expo/types/router.d.ts` is stale: delete it (it's ignored by git; CI never has it).
- React Native Testing Library v14: `render`, `rerender`, `fireEvent.*` and `act` are async, so always `await` them (an un-awaited `act` leaves the next test rendering nothing). `rerender` needs a **new** element (`app()`), not the same object.

| Area | Happy path | Negative |
|---|---|---|
| Transaction entry | valid ₱ spend saves; dashboard updates; draft restored after app restart | same `clientId` posted twice → one transaction (200, original returned); missing or malformed `clientId` → 400; amount ≤ 0 or non-numeric; more than 2 decimal places; removed category; date more than 1 year ahead; description over 500 characters; no token → 401 |
| Thresholds | crossing 90% → one "near"; crossing 100% → one "over" | already past 90% doesn't re-fire; budget 0 → no alert; delete doesn't fire |
| Notification fan-out | alert reaches **every** active member on **every** registered device (Expo + Web Push), including the person who entered the spend | muted member gets nothing; removed member gets nothing; member of household B gets nothing for household A; expired subscription (410) is deleted and doesn't break other sends; a push-service outage still saves the transaction and alert |
| Push registration | subscribe → stored; unsubscribe → removed | malformed subscription → 400; deleting another user's device → 404 |
| Toast (web) | shows, announces and dismisses | auto-dismisses no sooner than 10 seconds; never hides focused element |
| Over budget | remaining < 0 → bold, red, "Over by ₱X" | remaining exactly ₱0 → not flagged |
| Households | create household → House Owner; one user owns 2 households and is a House Member in a third; switching changes data and role-based UI | `X-Household-Id` the user isn't a member of → 404; removed member → 404 on next call; House Owner leaving without transfer → 409 |
| Roles | Co-Owner invites, removes a House Member, promotes a member to Co-Owner; House Owner transfers ownership (old owner becomes Co-Owner); House Member enters a spend and edits or deletes their **own** | **Co-Owner removes or demotes the House Owner → 403**; Co-Owner transfers ownership or deletes household → 403; House Member hits any category, budget or fixed-transaction write, invite or member route → 403; House Member deletes another person's transaction → 403; invite with role `owner` → 400; second active House Owner blocked by unique index |
| Invites | House Owner or Co-Owner invites; matching email accepts; user is now in 2 households | expired, used or revoked token → 410; email mismatch → 403; House Member creates invite → 403; already a member → 409; brute-force accept → 429 |
| Daily summary | 7 AM run: correct yesterday total from all members, correct remaining including today's 00:15 auto-posts; text reads "Yesterday {name} household spent ₱x"; sent to every enabled member's devices; one notification per household for multi-household users | run at 23:00 UTC computes *Manila* yesterday, not UTC; 1st of month reports last month's close plus the new budget; ₱0 day sends "had no spending recorded"; name ending in "Household" isn't doubled; 60-character name is truncated; over budget → "Over budget by ₱X"; disabled member gets nothing; cron re-run → no duplicate (`digestLog`); bad `CRON_SECRET` → 401; household with no budget doesn't crash |
| Categories | create, rename, remove, restore | duplicate name; removed category still shows on old transactions; another household's category ID → 404 |
| Fixed transactions | auto-post on the right day; day 31 posts on Feb 28/29 | cron re-run → no duplicate; disabled item skipped; bad `CRON_SECRET` → 401; empty bulk IDs → 400 |
| Budgets | override beats default; reset falls back | negative budget rejected; over-allocation warns without crashing |
| Breakdown | AND filters; personal pins on top under every sort | min > max → validation error; no results → empty state; cancelling delete keeps the row; pins on device 1 don't appear for another user on the same browser; pin of a deleted transaction is pruned; corrupt or missing pin storage → treated as no pins, no crash; no pin data in any API request |
| Security | — | `{"$gt":""}` payload rejected; disallowed CORS origin blocked; expired JWT → 401 |

---

## 12. Delivery milestones

| # | Milestone | Contents | Exit criteria |
|---|---|---|---|
| M0 | **Setup & hosting** | Atlas (§14), Clerk, Vercel, Cloudflare Pages and DNS (§13), monorepo, CI (lint, test, audit, gitleaks, axe), app shell with theme, adaptive nav and PHP formatting, Hono `/health` | `bdgtr.erroldee.com` loads and calls `bdgtr-api.erroldee.com/health`; Android dev build does the same |
| M1 | **Auth, households & roles** | Google sign-in, create household, members screen, three-role permission guard, transfer ownership, invites with share sheet and App Links, multi-household switcher | two accounts share a household; one account owns two households; Co-Owner can't remove the House Owner |
| M2 | **Categories & transactions** | Category CRUD, entry modal, dashboard, over-budget styling, bar chart, thresholds, Android push, Web Push + service worker, in-app toast, device settings | a spend from member A notifies member B on Android **and** in a closed desktop browser |
| M3 | **Budgets** | Default and monthly budget, per-category allocation, donut | override and reset verified |
| M4 | **Breakdown** | Month switching, filters, sort, personal pins, swipe and menu delete, description dialog | all of §6.8 working on Android and web |
| M5 | **Scheduled jobs** | Fixed-transaction CRUD, bulk add, Cloudflare Worker cron, 00:15 auto-post, **7 AM daily summary** plus its settings toggle | both jobs idempotent; summary arrives at 7:00 Manila on Android and web |
| M6 | **Hardening & release** | Foldable and desktop layout pass, TalkBack/NVDA audit, security headers check, backups, E2E suites, EAS production build, APK on `bdgtr.erroldee.com/download` with install guide, PWA manifest check, recheck Android developer verification status and register the free limited-distribution account if open | release checklist signed off |

---

## 13. Cloudflare domain setup (outline; full walkthrough in M0)

1. **Pages project** `bdgtr-web`, connected to the GitHub repo. Build command: `pnpm --filter mobile exec expo export -p web`. Output folder: `apps/mobile/dist`.
2. **Custom domain:** add `bdgtr.erroldee.com` to the Pages project. Cloudflare creates the DNS record automatically.
3. **SPA routing and headers:** commit `public/_redirects` (fallback to `/index.html`) and `public/_headers` (§10).
4. **App Links:** serve `/.well-known/assetlinks.json` with the app's signing certificate fingerprint, so invite links open the Android app.
5. **API:** in Vercel, add the domain `bdgtr-api.erroldee.com`. In Cloudflare DNS, add the CNAME Vercel gives you, set to **DNS only**.
6. **Clerk production instance:** set the application domain to `bdgtr.erroldee.com`, add the CNAME records Clerk lists (all **DNS only**), and add `https://bdgtr.erroldee.com` as an allowed origin.
   - **Before adding any record**, check that it doesn't clash with existing ones (`home.erroldee.com` and any mail records on the root domain).
7. **SSL/TLS** mode **Full (strict)**, **Always Use HTTPS** on, minimum TLS 1.2.

---

## 14. MongoDB Atlas sign-up & setup

1. Sign up at **mongodb.com/cloud/atlas/register** (Google sign-in works).
2. Create the organization **bdgtr** and the projects **bdgtr-prod** and **bdgtr-dev**.
3. **Create cluster** → **M0 Free**. Provider **AWS**, region **Singapore (ap-southeast-1)**, which is close to the Philippines and to Vercel's `sin1`. Name it `bdgtr-cluster`.
4. **Database Access → Add user:** password auth with an autogenerated password (save it in a password manager). Privilege: **`readWrite` on database `bdgtr`** only.
5. **Network Access:** for development, add your current IP. For production, add `0.0.0.0/0` (needed for Vercel's dynamic IPs; see §10 for the mitigations).
6. **Connect → Drivers → Node.js:** copy the `mongodb+srv://…` string. Put it in `apps/api/.env` as `MONGODB_URI` and in Vercel's environment variables. **Never put it in the app or in git.**
7. Turn on **MFA** for your Atlas login.
8. **Alerts:** email alerts at 80% storage and for connection spikes.

---

## 15. Future functionality (designed for, not built)

**AI spending analysis**
- A server-side `/insights` route sends **aggregated, de-identified** household summaries to an LLM (e.g. Claude). The API key lives in Vercel only.
- The household Owner must opt in (`households.aiInsightsEnabled`)
- An "Insights" card slot is reserved on the Dashboard

**Report export (monthly, yearly, per category)**
- `/reports?period=&format=csv|pdf` reuses the dashboard aggregation pipelines
- Android hands the file to the share sheet. On web it downloads directly.

### Offline capabilities

**Being built (after M6b), Android app only.** The owner decided the website stays online-only and never stores spending data, so the web rows below don't apply.

**Part 1 (built): offline entry.** In `src/offline/`:
- **`vault.ts`** keeps offline data in AsyncStorage, encrypted with XChaCha20-Poly1305 (`@noble/ciphers`, pure JS: no new native module). The 256-bit key is held in the Android Keystore through expo-secure-store. UTF-8 is handled in JS (`utf8.ts`) because Hermes may lack `TextDecoder`. Unreadable or tampered data reads as missing. Sign-out clears it.
- **`outbox-context.tsx`** handles saving and sending:
  - Add spend tries the server. If there's no connection, or no answer within 15 s, the spend is queued instead, and the person sees "Saved on this phone".
  - The queue sends oldest first on app start, when the app comes back to the front, after 5 s / 15 s / 30 s / 1 min / 5 min waits, and on "Send now". The idempotent `clientId` makes a repeat harmless.
  - A refusal (4xx) goes to **Needs attention** (Alerts tab) with the reason, and **Retry** / **Discard**. 401 pauses sending; 5xx and network errors retry later. Any server answer clears "offline".
- **Categories** are cached (`cached.ts`, `fetchWithCache`), so Add spend opens offline.
- **Starting offline** (fixed after the first phone test): Clerk's `__experimental_resourceCache` restores the session offline (experimental, Android only), and the household list (`/me`, key `cache:<user>:me`) is kept too. `apiFetch` sends a request even when Clerk has no fresh token, so offline shows as a network error rather than "not signed in".
- **Hardened after the second phone test:** `src/offline/network.ts` follows the phone's own connection status (`@react-native-community/netinfo`). With no connection `apiFetch` fails at once (`OfflineError`, a network error, so saved copies show and spends queue straight away), and a Clerk token wait gives up after 8 s. When the connection returns, sending resumes. **`OfflineWarmup`** (tabs layout) saves categories, the dashboard, this month's spends, budgets and alerts whenever the app is online, once per household per connection, so those work offline without being opened first. **More** disables its online-only items (Household, Categories, Fixed transactions, Settings, Sign out) offline with "Needs a connection"; Budgets stays, since it's saved.
- **What people see:** an offline banner on every screen, "Waiting to be sent" with **Pending** badges on Spend, and a warning before signing out with unsent spends.
- **Changed from the design above:** a spend whose category was removed while offline is **not** accepted. The server refuses removed categories, so it goes to Needs attention ("enter it again with another category"). **Editing a waiting spend (added later):** Spend → "Waiting to be sent" has **Edit** (opens Add spend pre-filled, `/add?pending=<clientId>`) and **Discard** (asks first).
- An edit keeps the **same clientId**, since the server never had it.
- Refused while that spend is being sent.
- Refused for spends queued after a **timeout** (`uncertain`): those may have reached the server already, which would keep the original under that clientId. The app says to let it send, then edit it in Spend.

**Part 2 (built): offline viewing.**
- `useCachedLoader` keeps an encrypted copy of what Dashboard, Spend (transactions and categories), Budgets/Budget per Category and Alerts last loaded. Copies are per person and household. Only **this month and last month** are kept (`isCachedMonth`).
- **Offline**, each of those screens shows its copy with "Showing data saved at 7:42 AM today. It updates when you're back online." (Manila time). Already offline, no retry waits, so the copy shows at once. Server errors (4xx/5xx) are never hidden behind an old copy.
- **Dashboard totals include pending spends** (`withPending`), with "Includes ₱X saved on this phone, not sent yet." Refused ones aren't counted.
- The offline banner follows what screens find: a saved copy means offline, fresh data means online. Coming back online also sends anything waiting.
- **Not done (from the design above):** TanStack Query (the app's own hooks do the caching) and IndexedDB / web Background Sync (website online-only).

**Goal:** with no connection, a member can still **see the last data they synced** and **enter transactions**, which **send automatically** once the connection returns. Setup tools (categories, budgets, fixed transactions, members) stay online-only, as you asked for.

#### What the user experiences
- **Offline banner** at the top: "You're offline. Showing data from 7:42 AM today." It's announced to screen readers and never covers the FAB or tab bar.
- **Dashboard, Breakdown, Budgets and Alerts** show the cached data read-only. Charts and totals include pending transactions, so the remaining amount stays honest.
- **+ Add spend works as normal.** The saved row shows a **"Pending" badge** (icon + text, not colour alone) and the toast says "Saved on this device. Will sync when you're back online."
- **On reconnect**, pending entries send by themselves. The badge disappears, and a toast says "3 transactions synced". Budget alerts are then calculated and sent to every member as usual.
- **Stuck entries** (see Conflicts) move to a "Needs attention" list in the Alerts tab, with **Retry**, **Edit** and **Discard**.
- Pending entries can be edited or deleted on the device before they sync.

#### How it works
| Piece | Native (Android) | Web |
|---|---|---|
| **Read cache:** last synced data | TanStack Query's persisted cache, saved to device storage (MMKV, encrypted, or AsyncStorage) | Same persisted cache in **IndexedDB**, which holds more data and is more reliable than `localStorage` |
| **Outbox:** queued transactions | An ordered queue in device storage. Each item holds `{ clientId, householdId, payload, attempts, lastError }`. | Same, in IndexedDB |
| **Detecting the connection** | `@react-native-community/netinfo`, plus re-checking whenever the app comes to the foreground | `online` / `offline` browser events. Chrome's **Background Sync** in the service worker can also flush the queue after the tab is closed. |
| **Sending** | Oldest first, one at a time, retrying with increasing delays and random jitter | Same |

- **Scope:** only the **current and previous month** are cached, so storage stays small.
- **Multiple households:** each household's cache and outbox are kept separate.

#### Groundwork built into v1, so offline needs no rework
1. **The app creates each transaction's ID** (`clientId`), and the server's unique index makes sending it twice harmless. A queued entry can be retried any number of times without creating duplicates.
2. **All transaction saves go through one `transactionsRepo` module.** Offline mode later puts the outbox inside that module, and no screens change.
3. **All device storage goes through one `storage` module.** Swapping in encrypted MMKV or IndexedDB happens in one place.
4. **Transactions record both `enteredAt` and `syncedAt`.** The entry keeps the date the user picked, and the server can tell when it actually arrived.
5. **Stable TanStack Query keys** per household and month, so the persisted cache maps cleanly onto screens

#### Conflicts & edge cases
| Situation when the queued entry finally syncs | Result |
|---|---|
| Category was **removed** while offline | Accepted. The entry was valid when made, and removed categories still resolve. Flagged in the toast. |
| Member was **removed** from the household, or **role changed** so they can't enter spends | Rejected (404/403). The entry goes to "Needs attention" so it isn't silently lost; the member can discard it or ask an owner to enter it. |
| **Sign-in session expired** while offline | The queue pauses and the member is asked to sign in again. Entries are kept and sent after sign-in. |
| Same entry sent twice (flaky network) | The server returns the original, so nothing is duplicated (idempotent `clientId`) |
| Entry dated in a **past month** | Accepted and counted toward that month. Threshold alerts only fire for the current month. |
| **7 AM summary** ran before an offline entry synced | That day's summary won't include it. The dashboard is correct as soon as it syncs. *(Possible refinement: a short "late entries" line in the next summary.)* |
| App **closed or phone restarted** with items queued | The queue is in persistent storage, so it resumes on next launch |

#### Security for cached data
Turning on offline means household financial data is stored on the device.
- **Android:** the cache is encrypted with a key held in **expo-secure-store** (Keystore), using MMKV's encryption.
- **Web:** offline caching is **off by default** and turned on per browser with **"This is my personal device"**. On shared computers nothing financial is stored. The cache is wiped on sign-out.
- **Separation:** cache and outbox are scoped per user and per household, and switching accounts never shows another user's cached data.
- **Pending entries left at sign-out:** the member is warned that they'll be lost if they continue, rather than silently deleting them.

#### Tests to add with the feature
| Happy path | Negative |
|---|---|
| Offline: dashboard shows cached data with the "Showing data from…" banner | No cache yet and offline → clear empty state, no crash |
| Entry made offline → shows "Pending" → reconnect → synced, badge gone, alerts fanned out | Same `clientId` sent twice → one transaction |
| 3 queued entries sync in order | Member removed while offline → entry lands in "Needs attention", not dropped |
| App killed with queue → relaunch → queue resumes | Expired session → queue pauses, resumes after sign-in |
| Pending entry edited or deleted before sync | Corrupt outbox item → quarantined; the rest still sync |
| Web "personal device" on → offline works | Web "personal device" off → nothing financial in IndexedDB |

#### Rough size
About one milestone (comparable to M4): the outbox and sync engine, the persisted cache, the encryption setup, UI states and tests.

**Other v2 candidates:**
- Income tracking (the template's "Income" tile)
- Viewer role
- Emailed invites through Resend
- Light theme
- iOS build
