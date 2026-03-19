/**
 * STEP 4 TESTS — API routes integration tests
 *
 * Uses Fastify's inject() to fire real HTTP requests
 * against the server without starting a TCP listener.
 *
 * Tests every route + status code:
 *   GET  /health           → 200
 *   GET  /api/sale         → 200, 404
 *   POST /auth/token       → 200, 400
 *   POST /api/purchase     → 201, 400, 401, 409, 410
 *   GET  /api/purchase/:id → 200, 401, 403
 */

import {
  describe, it, expect,
  beforeEach, afterAll, beforeAll
} from "@jest/globals";

process.env.DB_PATH     = ":memory:";
process.env.JWT_SECRET  = "test-secret-for-integration";
process.env.NODE_ENV    = "test";

import { FastifyInstance }   from "fastify";
import { buildApp }          from "../../src/app";
import { getDb, closeDb }    from "../../src/db/client";
import { getRedis, closeRedis, initStock } from "../../src/cache/redis";
import { generateToken }     from "../../src/services/authService";

// ----------------------------------------------------------------
// Setup
// ----------------------------------------------------------------

let app: FastifyInstance;
const NOW = Date.now();

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

beforeEach(async () => {
  // Fresh DB + Redis for every test
  closeDb();
  const r = getRedis();
  const keys = await r.keys("sale:*");
  if (keys.length) await r.del(...keys);
});

afterAll(async () => {
  closeDb();
  await closeRedis();
  await app.close();
});

// Helper — seed an active sale + Redis stock
function seedActiveSale(stock = 10) {
  const db = getDb();
  db.prepare(
    `INSERT INTO sales (product_name, total_stock, start_time, end_time)
     VALUES (?, ?, ?, ?)`
  ).run(
    "Test Sneaker", stock,
    new Date(NOW - 60_000).toISOString(),
    new Date(NOW + 60_000).toISOString()
  );
  return initStock(1, stock);
}

// Helper — get a valid token for a userId
function token(userId: string) {
  return `Bearer ${generateToken(userId)}`;
}

// ----------------------------------------------------------------
// Health check
// ----------------------------------------------------------------
describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

// ----------------------------------------------------------------
// GET /api/sale
// ----------------------------------------------------------------
describe("GET /api/sale", () => {
  it("returns 404 when no sale exists", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sale" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 with sale state when sale exists", async () => {
    await seedActiveSale(10);
    const res = await app.inject({ method: "GET", url: "/api/sale" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.product_name).toBe("Test Sneaker");
    expect(body.total_stock).toBe(10);
    expect(body.status).toBe("active");
    expect(body.remaining_stock).toBe(10);
  });

  it("returns upcoming status for a future sale", async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run(
      "Future Sneaker", 10,
      new Date(NOW + 60_000).toISOString(),
      new Date(NOW + 120_000).toISOString()
    );

    const res = await app.inject({ method: "GET", url: "/api/sale" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("upcoming");
  });
});

// ----------------------------------------------------------------
// POST /auth/token
// ----------------------------------------------------------------
describe("POST /auth/token", () => {
  it("returns 200 with a token for a valid userId", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/auth/token",
      payload: { userId: "alice@test.com" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBeDefined();
    expect(body.userId).toBe("alice@test.com");
  });

  it("returns 400 when userId is missing", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/auth/token",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when userId is too short", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/auth/token",
      payload: { userId: "ab" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for userId with invalid characters", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/auth/token",
      payload: { userId: "<script>alert(1)</script>" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ----------------------------------------------------------------
// POST /api/purchase
// ----------------------------------------------------------------
describe("POST /api/purchase", () => {
  it("returns 401 when no Authorization header", async () => {
    const res = await app.inject({ method: "POST", url: "/api/purchase" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for an invalid token", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/api/purchase",
      headers: { authorization: "Bearer not.a.real.token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when no sale exists", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/api/purchase",
      headers: { authorization: token("alice@test.com") },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 201 on successful purchase", async () => {
    await seedActiveSale(10);
    const res = await app.inject({
      method:  "POST",
      url:     "/api/purchase",
      headers: { authorization: token("alice@test.com") },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.purchaseId).toBeDefined();
    expect(body.message).toBe("Purchase confirmed");
  });

  it("returns 409 on duplicate purchase attempt", async () => {
    await seedActiveSale(10);

    await app.inject({
      method:  "POST",
      url:     "/api/purchase",
      headers: { authorization: token("alice@test.com") },
    });

    const res = await app.inject({
      method:  "POST",
      url:     "/api/purchase",
      headers: { authorization: token("alice@test.com") },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ALREADY_PURCHASED");
  });

  it("returns 410 when sold out", async () => {
    await seedActiveSale(1);

    await app.inject({
      method:  "POST",
      url:     "/api/purchase",
      headers: { authorization: token("alice@test.com") },
    });

    const res = await app.inject({
      method:  "POST",
      url:     "/api/purchase",
      headers: { authorization: token("bob@test.com") },
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe("SOLD_OUT");
  });

  it("returns 400 when sale is not active yet", async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run(
      "Future Sneaker", 10,
      new Date(NOW + 60_000).toISOString(),
      new Date(NOW + 120_000).toISOString()
    );

    const res = await app.inject({
      method:  "POST",
      url:     "/api/purchase",
      headers: { authorization: token("alice@test.com") },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("SALE_NOT_ACTIVE");
  });
});

// ----------------------------------------------------------------
// GET /api/purchase/:userId
// ----------------------------------------------------------------
describe("GET /api/purchase/:userId", () => {
  it("returns 401 when no Authorization header", async () => {
    const res = await app.inject({
      method: "GET",
      url:    "/api/purchase/alice@test.com",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when checking another user's status", async () => {
    const res = await app.inject({
      method:  "GET",
      url:     "/api/purchase/bob@test.com",
      headers: { authorization: token("alice@test.com") },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 200 with hasPurchased false before purchase", async () => {
    await seedActiveSale(10);
    const res = await app.inject({
      method:  "GET",
      url:     "/api/purchase/alice@test.com",
      headers: { authorization: token("alice@test.com") },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().hasPurchased).toBe(false);
  });

  it("returns 200 with hasPurchased true after purchase", async () => {
    await seedActiveSale(10);

    await app.inject({
      method:  "POST",
      url:     "/api/purchase",
      headers: { authorization: token("alice@test.com") },
    });

    const res = await app.inject({
      method:  "GET",
      url:     "/api/purchase/alice@test.com",
      headers: { authorization: token("alice@test.com") },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hasPurchased).toBe(true);
    expect(body.purchaseId).toBeDefined();
    expect(body.purchasedAt).toBeDefined();
  });
});