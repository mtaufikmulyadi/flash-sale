# Flash Sale System

A high-throughput flash sale backend built with Node.js, Fastify, Redis, and SQLite. Designed to handle thousands of concurrent purchase requests while preventing overselling and enforcing one-item-per-user rules.

---

## Architecture

```
React SPA (Vite)
      │
      ▼ HTTP/REST
Middleware (rate limit → auth → validation)
      │
      ▼
API Server (Fastify)
   ├── GET  /api/sale
   ├── POST /api/purchase
   └── GET  /api/purchase/:userId
      │
      ├──▶ Redis  (stock counter + dedup — atomic ops)
      └──▶ SQLite (durable purchase records)
```

### Why this stack

| Choice | Reason |
|---|---|
| **Fastify** | Fastest Node.js HTTP framework, built-in schema validation |
| **Redis** | Single-threaded atomic ops (DECR, SETNX) — handles concurrency without locks |
| **SQLite (node:sqlite)** | Zero-install, built into Node 22+, no native compilation needed |
| **Zod** | Runtime input validation with TypeScript inference |

---

## Concurrency Control

The core of the system. Two atomic Redis operations make overselling impossible:

```
POST /api/purchase
  │
  ├─ 1. SET user:{userId}:bought NX EX 86400
  │       → nil  = already bought → 409
  │       → OK   = continue
  │
  ├─ 2. DECR sale:{saleId}:stock
  │       → < 0  = sold out → INCR (compensate) + DEL user key → 410
  │       → ≥ 0  = slot reserved → continue
  │
  └─ 3. INSERT INTO purchases → 201 confirmed
```

Redis is single-threaded — it cannot process two DECRs at the same instant. This guarantees exactly N purchases for N stock, regardless of concurrent load.

---

## Request Trust Pipeline

Every purchase request passes through 8 gates in order:

| Gate | Layer | Rejects with |
|---|---|---|
| Rate limit (10 req/10s per IP) | Network | 429 |
| Valid JSON + Content-Type | HTTP | 400 |
| userId present, 3–100 chars, no injection | HTTP | 400 |
| userId identity check | App | 401 |
| User not banned | App | 403 |
| Sale window active (server time) | Business | 400 |
| User hasn't bought already (SETNX) | Business | 409 |
| Stock available (DECR) | Business | 410 |

---

## Project Structure

```
flash-sale/
├── src/
│   ├── server.ts              ← Fastify app entry point
│   ├── routes/
│   │   ├── sale.ts            ← GET /api/sale
│   │   └── purchase.ts        ← POST /api/purchase
│   ├── services/
│   │   ├── saleService.ts     ← sale window / status logic
│   │   └── purchaseService.ts ← SETNX + DECR + DB write
│   ├── middleware/
│   │   ├── rateLimiter.ts
│   │   └── validator.ts
│   ├── db/
│   │   ├── client.ts          ← node:sqlite connection
│   │   ├── schema.sql         ← sales + purchases tables
│   │   └── seed.ts            ← dev seed script
│   └── cache/
│       └── redis.ts           ← ioredis client + key helpers
├── tests/
│   ├── unit/
│   │   ├── step1-connections.test.ts  ← DB + Redis connectivity
│   │   ├── step2-sale-service.test.ts ← sale window logic
│   │   └── step3-purchase-service.test.ts ← SETNX/DECR logic
│   ├── integration/
│   │   └── step4-routes.test.ts       ← full HTTP cycle
│   └── stress/
│       └── purchaseLoad.ts            ← 500 concurrent requests
├── frontend/
│   └── src/
│       ├── App.tsx
│       └── components/SaleWidget.tsx
├── package.json
├── tsconfig.json
└── jest.config.ts
```

---

## Database Schema

```sql
-- Sale configuration
sales (
  id, product_name, total_stock,
  start_time, end_time, status, created_at
)

-- Confirmed purchases — UNIQUE(user_id, sale_id) as DB-level safety net
purchases (
  id, user_id, sale_id, status, purchased_at
)
```

Redis is the fast guard. The DB UNIQUE constraint is a fallback in case Redis ever restarts mid-sale.

---

## Redis Key Design

```
sale:{saleId}:stock              ← INT  remaining stock counter
sale:{saleId}:user:{userId}:bought ← "1"  exists if user has purchased (TTL 24h)
sale:{saleId}:config             ← JSON cached sale config
```

All key names are defined in one place (`src/cache/redis.ts → RedisKeys`) so renaming is a single-file change.

---

## Getting Started

### Prerequisites

- Node.js 22+
- Docker (for Redis)
- Python 3.8+ (for the one-click setup script)

### One-click setup (Windows)

Run the setup script — it installs Docker if needed, pulls the Redis image, starts the container, and verifies the connection automatically:

```bash
python setup.py
```

The script handles everything in order:
1. Checks Python version
2. Installs Docker Desktop if not found (downloads ~600 MB installer)
3. Pulls `redis:alpine` image
4. Creates and starts the `flash-sale-redis` container on port 6379
5. Sends a PING and confirms PONG
6. Creates your `.env` from `.env.example`

After it finishes you should see:

```
✓  Docker engine        running
✓  Redis container      flash-sale-redis → port 6379
✓  Connection           PONG confirmed
```

> **Note:** If Docker Desktop was just installed, the script will ask you to open it and wait for the engine to start before continuing.

### Manual setup

```bash
# 1. Start Redis
docker run -d --name flash-sale-redis -p 6379:6379 --restart unless-stopped redis:alpine

# 2. Verify Redis
docker exec flash-sale-redis redis-cli ping
# → PONG

# 3. Install dependencies
npm install

# 4. Copy env file
cp .env.example .env
```

### Run tests

```bash
# All tests (81 total)
npm test

# Unit tests only (DB, Redis, services)
npm run test:unit

# Integration tests only (HTTP routes)
npm run test:integration

# Stress test (500 concurrent purchase attempts)
npm run test:stress
```

### Run the server

```bash
# Development (auto-restart on file change)
npm run dev

# Production
npm run build && npm start
```

### Run the frontend

```bash
cd frontend
npm install
npm run dev
```

Open in browser:
- `http://localhost:5173` — sale page
- `http://localhost:5173/admin` — admin page (create + configure sales)

### Seed a sale

```bash
# Default — starts in 1 min, 30 min duration, 10 items
npx ts-node src/db/seed.ts

# Custom stock and timing
npx ts-node src/db/seed.ts --stock 50 --in 5 --duration 60

# Start immediately (useful for local testing)
npx ts-node src/db/seed.ts --now --stock 10

# Exact ISO timestamps
npx ts-node src/db/seed.ts --start "2024-06-01T14:00:00Z" --end "2024-06-01T14:30:00Z" --stock 100

# Custom product name
npx ts-node src/db/seed.ts --product "Air Max 90" --stock 25 --in 2

# Show all options
npx ts-node src/db/seed.ts --help
```

**CLI arguments:**

| Arg | Description | Default |
|---|---|---|
| `--stock <n>` | Number of items available | `10` |
| `--in <mins>` | Start in N minutes from now | `1` |
| `--duration <mins>` | Sale duration in minutes | `30` |
| `--start <iso>` | Exact start time as ISO 8601 | — |
| `--end <iso>` | Exact end time as ISO 8601 | — |
| `--now` | Start the sale immediately | — |
| `--product <name>` | Product name | `"Limited Edition Sneaker"` |

`--start` and `--end` take priority over `--in` and `--duration` when both are provided.

The seed script is safe to run multiple times. Each run clears all `sale:*` keys from Redis and wipes the DB before inserting a fresh sale.

> **Never run the seed while a sale is in progress** — it will wipe active purchases.

---

## Stress Test

`tests/stress/purchaseLoad.ts` — proves the system never oversells under concurrency.

```bash
npm run test:stress
```

Fires **500 concurrent purchase requests** at a sale with **10 items**. Uses Fastify's `inject()` so no real TCP server is needed.

### What it asserts

| # | Assertion | Why it matters |
|---|---|---|
| 1 | Exactly 10 confirmed purchases (201s) | Stock was never exceeded |
| 2 | DB has exactly 10 purchase records | Every 201 was persisted |
| 3 | Zero duplicate purchases in DB | One-per-user rule held |
| 4 | Redis stock counter = 0 after all purchases | Compensation logic worked correctly |
| 5 | All 500 requests received a response | No hangs or crashes |
| 6 | All responses are accounted for | No unexpected status codes |
| 7 | Server still healthy after load | No memory leaks or crashes |

### Expected output

```
  Flash Sale — Stress Test
  500 concurrent users · 10 items in stock

  → Building app...
  → Seeding sale with stock=10, starting NOW...
  ✓ Sale seeded and active
  → Generating 500 user tokens...
  → Firing 500 concurrent purchase requests...
  → All requests completed in ~300ms

  Response breakdown:
    201 Confirmed:       10
    409 Already bought:   0
    410 Sold out:        490

  Assertions:
  ✓ Exactly 10 confirmed purchases (201s)
  ✓ DB has exactly 10 purchase records
  ✓ Zero duplicate purchases in DB
  ✓ Redis stock counter = 0 after all purchases
  ✓ All 500 requests received a response
  ✓ All responses are accounted for
  ✓ Server still healthy after load

  ────────────────────────────────────────────────
  All 7 assertions passed ✓
  500 users · 10 items · ~300ms · zero oversell
```

### Why this works

500 users all call `DECR` on the same Redis key simultaneously. Redis is single-threaded — it processes each `DECR` serially. The first 10 get a non-negative result and proceed to the DB write. The remaining 490 get a negative result, trigger the compensation (`INCR` + `DEL` user key), and receive 410. No locks, no queues — just atomic operations.

---

## Known Issues & Fixes

### Bug — stock shows more than total (e.g. `14 / 10`)

**Cause:** Running `npx ts-node src/db/seed.ts` multiple times without clearing Redis creates new DB sales but reuses stale Redis stock keys from previous runs. The counter ends up out of sync with the actual stock.

**Fix — always use the seed script to reset:**
```bash
del flash-sale.db
docker exec flash-sale-redis redis-cli FLUSHALL
npx ts-node src/db/seed.ts
```

The updated seed script handles this automatically — it flushes Redis sale keys and clears the DB before every seed run.

**Safety net in UI:** `SaleStatus.tsx` clamps `remaining_stock` to `[0, total]` before rendering, so the bar and counter never display an impossible value even if Redis has stale data.

### Bug — rate limiter triggers during integration tests

**Cause:** All integration tests share one Fastify instance. The rate limiter counts requests globally across that shared instance, so later tests hit the 10 req/10s limit and receive 429 instead of the expected status code.

**Fix:** Rate limiter is disabled when `NODE_ENV=test`. It is fully active in development and production.

```ts
if (process.env.NODE_ENV !== "test") {
  await app.register(rateLimit, { max: 10, timeWindow: "10 seconds" });
}
```

### Bug — `req.userId` not available in route handlers

**Cause:** Fastify's plugin encapsulation scope prevents decorator values from being accessible across plugin boundaries when using `app.authenticate` as a decorator.

**Fix:** `authenticate` is exported as a plain function from `authMiddleware.ts` and imported directly by routes. The `userId` decoration happens in `buildApp()` before any routes register.

```ts
// routes import authenticate directly — no plugin scope issues
import { authenticate } from "../middleware/authMiddleware";
app.post("/purchase", { preHandler: [authenticate] }, handler);
```

---



## Implementation Progress

- [x] Step 1 — Database schema + Redis client (19 tests ✓)
- [x] Step 2 — Sale service logic (23 tests ✓)
- [x] Step 2b — Mock auth service (20 tests ✓)
- [x] Step 3 — Purchase service logic (20 tests ✓)
- [x] Step 4 — API routes + middleware (19 tests ✓)
- [x] Step 5 — React frontend — sale page + admin page (14 tests ✓)
- [x] Step 6 — Stress test (7 assertions ✓)

---

## Sale Service

Pure functions in `src/services/saleService.ts` — no HTTP, no routes. All time checks use **server time only** (`Date.now()`), never the client clock.

| Function | What it does |
|---|---|
| `isSaleActive(sale)` | Returns true if now is within start/end window |
| `isSaleUpcoming(sale)` | Returns true if now is before start_time |
| `isSaleEnded(sale)` | Returns true if now is past end_time |
| `getSaleStatus(sale)` | Returns `"upcoming"` / `"active"` / `"ended"` |
| `getActiveSale()` | Fetches most recent sale from DB |
| `getSaleState()` | Full state including live Redis stock count |
| `initialiseSaleStock(id)` | Seeds Redis counter from DB total_stock |

`getSaleState()` is what `GET /api/sale` returns to the frontend:

```json
{
  "id": 1,
  "product_name": "Limited Edition Sneaker",
  "total_stock": 10,
  "remaining_stock": 7,
  "status": "active",
  "start_time": "2024-06-01T14:00:00.000Z",
  "end_time": "2024-06-01T14:30:00.000Z"
}
```

---



**Redis restart risk** — If Redis restarts mid-sale, the in-memory stock counter is lost. Mitigations: enable Redis AOF persistence (`appendonly yes`), or re-initialise from DB count on startup. For this project, Docker's `--restart unless-stopped` flag keeps Redis alive.

**SQLite vs PostgreSQL** — SQLite is perfect for a single-process dev/demo environment. For a multi-instance production deployment, swap to PostgreSQL (change the `getDb()` client, schema stays the same).

**Rate limiter scope** — The current rate limiter is per-process. In a multi-instance deployment behind a load balancer, use a Redis-backed sliding window limiter so limits are global across all instances.

**Authentication vs Authorization** — These are two different things that are easy to mix up:
- **Authentication (gate 4)** = *Who are you?* — proving identity. `"I am alice@gmail.com"`
- **Authorization (gate 5)** = *What can you do?* — checking permission. `"Is alice allowed to buy?"`

For this project, `userId` in the request body acts as identity — there is no real login system. This is intentional for the take-home scope. In production, this would be a JWT signed by an auth server. The server would verify the signature and extract the `userId` from the token rather than trusting whatever the client sends — so nobody can fake being someone else.

**Server time for sale window** — The sale window check always uses `Date.now()` on the server, never anything from the client's request. If you trusted the client's clock, a user could manipulate their system time to attempt a purchase before the sale opens. Server time only.

---

## Frontend

Built with React + Vite + TypeScript. Two pages, zero router libraries.

### Sale page — `http://localhost:5173`

The main user-facing page. Polls `GET /api/sale` every 5 seconds.

| State | What the user sees |
|---|---|
| Upcoming | Countdown timer to sale start |
| Active | Live stock bar + countdown to end + Buy Now button |
| Ended | Sale has ended message |

Two-step purchase flow:
1. Enter a userId (e.g. `alice@example.com`) → gets a JWT from `/auth/token`
2. Click **Buy Now** → calls `POST /api/purchase` with the JWT
3. Shows result: success / already purchased / sold out / not active

### Admin page — `http://localhost:5173/admin`

Lets you configure and create a new sale without touching the CLI.

**Current sale card** — shows product name, stock remaining, status badge, and start/end times.

**Create sale form** — fields for:
- Product name
- Stock count
- Start time (datetime picker, local timezone)
- End time (datetime picker, local timezone)

Creating a new sale clears all existing sales and purchases and re-seeds Redis. Both the admin card and the main sale page update automatically via React Query cache invalidation.

### API endpoints used by the frontend

| Route | Used by |
|---|---|
| `GET /api/sale` | Sale page — polls every 5s |
| `POST /auth/token` | Login form — gets JWT |
| `POST /api/purchase` | Buy Now button |
| `GET /api/purchase/:userId` | Checks if user already bought |
| `GET /admin/sale` | Admin page — current config |
| `POST /admin/sale` | Admin page — create new sale |

---

## API Routes

`src/routes/` — thin route handlers that validate input, call the service layer, and map results to HTTP status codes. No business logic lives here.

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Server health check |
| `GET` | `/api/sale` | None | Current sale state + live stock |
| `POST` | `/api/purchase` | JWT | Attempt to purchase |
| `GET` | `/api/purchase/:userId` | JWT | Check own purchase status |
| `POST` | `/auth/token` | None | Get a JWT (dev only) |
| `GET` | `/admin/sale` | None | Get current sale config |
| `POST` | `/admin/sale` | None | Create a new sale (clears existing) |

### Request / response examples

**Get a token (dev only):**
```bash
curl -X POST http://localhost:3000/auth/token \
  -H "Content-Type: application/json" \
  -d '{"userId": "alice@example.com"}'

# { "token": "eyJhbG...", "userId": "alice@example.com" }
```

**Check sale status:**
```bash
curl http://localhost:3000/api/sale

# { "id": 1, "product_name": "Limited Edition Sneaker",
#   "total_stock": 10, "remaining_stock": 7,
#   "status": "active", "start_time": "...", "end_time": "..." }
```

**Attempt a purchase:**
```bash
curl -X POST http://localhost:3000/api/purchase \
  -H "Authorization: Bearer eyJhbG..."

# 201: { "message": "Purchase confirmed", "purchaseId": 42 }
# 400: { "error": "SALE_NOT_ACTIVE", "message": "Sale has ended" }
# 409: { "error": "ALREADY_PURCHASED", "message": "You have already purchased..." }
# 410: { "error": "SOLD_OUT", "message": "Sorry, this item is sold out" }
```

### Key implementation notes

**Rate limiter is disabled in `NODE_ENV=test`** — the rate limiter is a global Fastify plugin that counts requests across all tests in a shared instance. Disabling it in test mode prevents tests from accidentally triggering each other's limits. The rate limiter is fully active in development and production.

**Routes are auth-agnostic via `preHandler`** — protected routes use `{ preHandler: [authenticate] }`. The `authenticate` function verifies the JWT and sets `req.userId`. The route handler never touches the `Authorization` header directly.

**userId comes from the token, not the body** — `POST /api/purchase` has no request body. The userId is extracted from the verified JWT by `authMiddleware` and placed on `req.userId`. This prevents clients from impersonating other users.

---



`src/services/purchaseService.ts` — the heart of the system. Runs the full 4-gate atomic buy flow.

| Function | What it does |
|---|---|
| `attemptPurchase(userId)` | Runs the full buy flow, returns a typed result |
| `getPurchaseStatus(userId)` | Checks Redis then DB — has this user bought? |

### Buy flow

```
attemptPurchase("alice@test.com")
  │
  ├─ Gate 1: sale exists + isSaleActive()
  │           fail → { success: false, code: "SALE_NOT_FOUND" | "SALE_NOT_ACTIVE" }
  │
  ├─ Gate 2: SETNX user:{userId}:bought NX EX 86400
  │           fail → { success: false, code: "ALREADY_PURCHASED" }
  │
  ├─ Gate 3: DECR sale:{saleId}:stock
  │           < 0  → compensate (INCR + DEL user key)
  │                  { success: false, code: "SOLD_OUT" }
  │
  └─ Gate 4: INSERT INTO purchases
              fail → compensate (INCR + DEL user key)
                     { success: false, code: "DB_ERROR" }
              pass → { success: true, purchaseId: N }
```

### Compensation (saga pattern)

If stock goes negative or the DB write fails, we immediately undo both Redis operations in parallel:

```ts
await Promise.all([
  incrementStock(saleId),           // restore the counter
  unmarkUserBought(saleId, userId), // remove the user key
]);
```

This ensures a failed purchase never permanently consumes a stock slot or blocks a user from retrying.

### Return type

`attemptPurchase` returns a typed result object — never throws. Route handlers just check `result.success` and send the correct HTTP status code:

```ts
type PurchaseResult =
  | { success: true;  purchaseId: number; message: string }
  | { success: false; code: PurchaseErrorCode; message: string }

// HTTP mapping:
// success: true       → 201 Created
// SALE_NOT_FOUND      → 400 Bad Request
// SALE_NOT_ACTIVE     → 400 Bad Request
// ALREADY_PURCHASED   → 409 Conflict
// SOLD_OUT            → 410 Gone
// DB_ERROR            → 500 Internal Server Error
```

---

## Auth Service (Mock JWT)

`src/services/authService.ts` + `src/middleware/authMiddleware.ts`

Simulates a real JWT auth system without a full auth server. The pattern is production-correct — only the secret management is simplified.

| Function | Used by | What it does |
|---|---|---|
| `generateToken(userId)` | Tests + seed script | Signs a JWT — acts as the mock auth server |
| `verifyToken(token)` | `authMiddleware` | Verifies signature, returns payload. Throws on invalid/expired |
| `extractBearerToken(header)` | `authMiddleware` | Parses `Authorization: Bearer <token>` header |

**How the flow works:**

```
Client sends:  Authorization: Bearer eyJhbG...

authMiddleware:
  1. extractBearerToken(req.headers.authorization) → token
  2. verifyToken(token) → { userId: "alice@test.com" }
  3. req.userId = "alice@test.com"

Route handler:
  reads req.userId — never touches the Authorization header directly

Service layer:
  receives userId as a plain string parameter
  completely auth-agnostic — doesn't know or care how it was verified
```

**Why services don't need to change** — separation of concerns. The service layer only handles business logic. How `userId` was verified (JWT, session, API key) is the middleware's responsibility. This makes services easy to test (just pass any string) and easy to swap auth methods later without touching business logic.

**What's mocked vs what's real:**

| | This project | Production |
|---|---|---|
| Token signing | `generateToken()` in authService | Dedicated auth server (Auth0, Cognito, custom) |
| Token verification | `verifyToken()` — same pattern | `verifyToken()` — identical code |
| Secret storage | `JWT_SECRET` in `.env` | AWS KMS, HashiCorp Vault, etc. |
| Token expiry | 24h hardcoded | Configurable per user role |

Generate a secure secret for your `.env`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---



The following are intentionally not implemented due to the take-home scope. They are documented here to show awareness of what a production system would require.

| Feature | What's missing | Production approach |
|---|---|---|
| **Real authentication** | Mock JWT — `userId` verified via signed token, but no real auth server | Dedicated auth server (Auth0, Cognito) issues tokens |
| **Real authorization** | No ban list, no user roles | Middleware checks user status against a users table |
| **Multi-instance rate limiting** | Rate limiter is per-process only | Redis-backed sliding window shared across all instances |
| **Redis persistence** | Stock lost on Redis restart | Enable AOF (`appendonly yes`) or re-seed from DB on startup |
| **Payment processing** | No actual payment step | Queue payment to a third-party API (Stripe etc.) after reservation |
| **Email confirmation** | No confirmation sent | Queue an email job after successful purchase |
| **Sale admin UI** | Sale is created via seed script only | Admin dashboard to create/configure sales |
| **Multi-product support** | Single product per sale only | Extend schema to support product catalogue |
| **Global deployment** | Single server, single region | Multi-region with distributed Redis cluster |
