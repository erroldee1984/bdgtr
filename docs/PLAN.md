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

### API stack
- **Hono** runs unchanged on Vercel, Node or Cloudflare Workers, so the host can change later without a rewrite
- Official **MongoDB Node driver** plus Zod. The client is cached across warm invocations.
- Clerk JWT verification (JWKS)
- **Scheduled jobs** are triggered by a tiny **Cloudflare Worker with Cron Triggers** (free, minute-accurate). It calls the API's internal endpoints with a `CRON_SECRET`:
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

### 2b. Notifications to all household members

When a spend crosses a threshold (§6.3), the API **fans out the alert to every active member of that household**. That includes the person who entered the spend, minus anyone who has muted alerts.

| Where the member is | How the alert arrives |
|---|---|
| Android app (open, background or closed) | System notification through Expo Push → FCM. Tapping it opens the Dashboard for that household. |
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
- `categoryBudget(month, cat) = categoryBudgets[month, cat] ?? category.defaultBudget`
- `unallocated(month) = totalBudget − Σ categoryBudget`. A negative value means over-allocated, which shows a warning.
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
GET    /transactions?month=&categoryIds=&min=&max=&sort=date|amount&dir=asc|desc [OCM]
POST   /transactions [OCM]                   { clientId, … } → { transaction, alerts[] }
                                             same clientId again → 200 with the original (idempotent)
PATCH  /transactions/:id  DELETE /transactions/:id   [OC] any · [M] own only (else 403)
GET    /categories [OCM]                     POST/PATCH/DELETE [OC] (DELETE = soft remove; POST /:id/restore)
GET    /fixed-transactions [OCM]             POST/PATCH/DELETE [OC]
POST   /fixed-transactions/bulk-post [OC]    { ids[], date }
GET    budgets (all routes below) [OCM]      PUT/DELETE [OC]
       /budgets/default
       /budgets/monthly/:yearMonth                         (DELETE = reset to default)
       /budgets/categories/default/:categoryId
       /budgets/categories/:yearMonth/:categoryId
GET    /alerts?month= [OCM]
PATCH  /membership/me [OCM]                  { alertsMuted, dailyDigestEnabled }

# Device push registration (no X-Household-Id)
POST   /push-subscriptions                   { kind, expoToken | webPushSubscription, deviceLabel }
GET    /push-subscriptions                   DELETE /push-subscriptions/:id   (own devices only)
GET    /push/vapid-public-key

# Internal
POST   /internal/cron/fixed-postings         (Authorization: Bearer CRON_SECRET)
POST   /internal/cron/daily-digest           (Authorization: Bearer CRON_SECRET)
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
- Category: grid of chips, most-used first
- Amount: numeric keypad opens with autofocus, ₱ prefix, centavos allowed
- Description: optional, collapsed by default
- After saving, the API works out threshold crossings, saves `alerts` and **fans them out to every active household member's registered devices** (Android push plus browser Web Push), skipping members who muted this household. The person who entered the spend also sees an in-app toast straight away. Delivery rules are in §2b.

**Threshold rule** (pure function, heavily tested):
> For the transaction's category and for the household total: reaching 90% or more fires **"near"**; going above 100% fires **"over"**. **For a category, every new spend while it's at 90% or more sends its current alert again** ("near" or "over", the same wording, with the updated percentage or amount). **The household total fires each level once a month** (a unique index enforces the first alert per crossing). A spend that jumps past both sends only "over", and a budget of zero or no budget never fires.
>
> The check is "what level has spending reached, and has this household had that alert yet this month?" rather than "did this one spend cross the line?", so simultaneous spends that only together cross a line still produce exactly one alert. Only new spends set off alerts (not edits or deletes).

### 6.4 Categories
Add, edit (name, icon, colour, default budget) and remove, with confirmation explaining that past transactions keep the category. A "Show removed" toggle allows restore. **A household always has at least one active category:** new households start with **Groceries**, any household found with none gets Groceries added automatically, and the last active category can't be removed (the API refuses with 409 `last_category`; the app shows Remove disabled on it and says why).

### 6.5 Monthly Fixed Transactions
- CRUD list: name, category, amount, day of month, auto-post toggle
- **Auto-post**: the daily cron posts every enabled item whose day matches today in Manila time. Days 29–31 clamp to the last day of the month. The unique index on `fixedPostings` prevents duplicates.
- **Bulk add**: tap "Select", tick items, choose a date, then "Add N transactions". Items already posted this month are flagged, and the user can skip them or post again.

### 6.6 Budget Allocation for the Month
Month switcher. Shows the default monthly budget (editable) and this month's value, with a "Custom" badge and "Reset to default" when overridden. Link to **Allocate per category →**.

### 6.7 Budget Allocation per Category (template screen 3)
- Donut showing the % of the total allocated and the **unallocated balance** (red plus icon if over-allocated)
- A **Defaults | This month** segmented control
- Rows show the default value, this month's value, a "Custom" badge and reset

### 6.8 Monthly Spend Breakdown
- Month selector, defaulting to the current month, with ‹ › arrows and a month picker
- Filters: category multi-select and a min–max ₱ range (min ≤ max is validated). Combined with AND.
- Sort: date or cost, ascending or descending. **The member's own pinned rows always come first**, with filters still applied to them.
- **Pins are stored on the device only:**
  - Android uses AsyncStorage and web uses `localStorage`, keyed by `pins:<userId>:<householdId>` and holding a set of transaction IDs. The API never receives pins.
  - Pins don't sync between a member's devices, and reinstalling or clearing browser data loses them. That's acceptable because pins aren't critical.
  - Pin IDs for transactions that no longer exist are pruned when the month loads. All pin keys for the user are cleared on sign-out, so a shared computer doesn't keep them.
  - Since pinning is applied on the device, the month's filtered list is fetched **whole, without pagination**. A household month is a few hundred rows at most. Pinned-first ordering is a pure function in `shared`.
- Each row shows **Date · Category · Cost** only
- Tap a row to open a dialog with its description, or "No description"
- **Swipe left**: Delete, with a confirmation dialog. **Swipe right**: toggle pin, no confirmation.
- **House Members** can swipe-delete only rows they entered. On other rows, swipe left does nothing and the menu doesn't offer Delete. Pinning works for everyone.
- **Non-swipe alternatives** for accessibility and for mouse users: long-press or right-click opens a menu, a visible "⋯" row button on web and wide screens, and TalkBack/ARIA custom actions

### 6.9 Household & Members
See §3.

### 6.10 Alerts
Monthly list of budget alerts: who triggered each one, the category, and the level. An unread badge sits on the tab. This is the durable record behind every push and toast.

### 6.11 Daily 7:00 AM summary notification
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
- **Two-pane layouts start at medium too when the content fits** (to be decided per screen in M2–M4). The unfolded Fold 6 should get the dashboard summary beside its chart, not just a wider single column.
- **Two-pane layouts on expanded widths:**
  - Dashboard: summary beside the chart
  - Breakdown: list beside filters and detail
  - Maintenance screens: list beside the edit form
  - Members: list beside invites
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
  - **axe-core through Playwright** on every web screen in CI
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
- Rate limiting, secure headers, body size limits, generic error responses
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
- **Backups:** M0 has no automated backups. A weekly GitHub Actions job runs `mongodump` into an encrypted artifact or a private R2 bucket (both free).

**Supply chain:** lockfile, Renovate or Dependabot, and `pnpm audit` in CI that fails on high or critical findings.

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

**Coverage is enforced:** `pnpm test` (and so `pnpm check` and CI) fails if coverage drops below: shared 90%; API 85% (branches 80%); app 85% statements/lines, 80% branches, 75% functions, counted over **every** app file, not only the ones a test touches.

**Writing app (Jest) tests:**
- Mocked hooks must return the **same** functions and objects on every render, like the real ones (Clerk's `useAuth`, `useFetchMe`). A new function per render makes effects refetch forever and the test hangs.
- React Native Testing Library v14: `render`, `rerender` and `fireEvent.*` are async, so always `await` them. `rerender` needs a **new** element (`app()`), not the same object.

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
