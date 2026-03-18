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
├── jest.config.ts
└── setup.py
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
# Unit tests (DB + Redis + service logic)
npm run test:unit

# Integration tests (full HTTP routes)
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

### Seed a sale

```bash
npx ts-node src/db/seed.ts
# Creates a sale starting 1 minute from now with 10 items
```

---

## Implementation Progress

- [x] Step 1 — Database schema + Redis client (19 tests ✓)
- [ ] Step 2 — Sale service logic
- [ ] Step 3 — Purchase service logic
- [ ] Step 4 — API routes + middleware
- [ ] Step 5 — React frontend
- [ ] Step 6 — Stress test

---

## Trade-offs & Notes

**Redis restart risk** — If Redis restarts mid-sale, the in-memory stock counter is lost. Mitigations: enable Redis AOF persistence (`appendonly yes`), or re-initialise from DB count on startup. For this project, Docker's `--restart unless-stopped` flag keeps Redis alive.

**SQLite vs PostgreSQL** — SQLite is perfect for a single-process dev/demo environment. For a multi-instance production deployment, swap to PostgreSQL (change the `getDb()` client, schema stays the same).

**Rate limiter scope** — The current rate limiter is per-process. In a multi-instance deployment behind a load balancer, use a Redis-backed sliding window limiter so limits are global across all instances.

**No real auth** — `userId` in the request body is treated as identity. In production, this would be a JWT signed by an auth service — the server would verify the signature and extract the userId rather than trusting the client.
