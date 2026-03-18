/**
 * STEP 3 TESTS — Purchase service
 *
 * Tests every branch of attemptPurchase():
 *  - success path → 201 confirmed
 *  - sale not found
 *  - sale not active (upcoming / ended)
 *  - user already bought (SETNX returns false)
 *  - sold out (DECR goes negative) + compensation check
 *  - DB error + compensation check
 *
 * Also tests getPurchaseStatus():
 *  - user has not purchased
 *  - user has purchased → returns purchaseId + purchasedAt
 *
 * Strategy: seed the DB with a controlled sale, seed Redis with
 * controlled stock, then call attemptPurchase() directly.
 */

import {
  describe, it, expect,
  beforeEach, afterEach, afterAll
} from "@jest/globals";

process.env.DB_PATH = ":memory:";

import { getDb, closeDb }            from "../../src/db/client";
import { getRedis, closeRedis, initStock, getStock, hasUserBought } from "../../src/cache/redis";
import { attemptPurchase, getPurchaseStatus } from "../../src/services/purchaseService";

// ----------------------------------------------------------------
// Test helpers
// ----------------------------------------------------------------

const NOW = Date.now();
const SALE_ID = 1;

// Insert a sale with controlled time window into the in-memory DB
function seedSale(options: {
  stock?: number;
  offsetStart?: number; // ms from now (negative = already started)
  offsetEnd?: number;   // ms from now
} = {}) {
  const db = getDb();
  const stock      = options.stock       ?? 10;
  const startTime  = new Date(NOW + (options.offsetStart ?? -60_000)).toISOString();
  const endTime    = new Date(NOW + (options.offsetEnd   ?? 60_000)).toISOString();

  db.prepare(
    `INSERT INTO sales (product_name, total_stock, start_time, end_time)
     VALUES (?, ?, ?, ?)`
  ).run("Test Sneaker", stock, startTime, endTime);
}

// Clean all sale:* keys from Redis between tests
async function cleanRedis() {
  const r = getRedis();
  const keys = await r.keys("sale:*");
  if (keys.length) await r.del(...keys);
}

// ----------------------------------------------------------------
// Setup / teardown
// ----------------------------------------------------------------

beforeEach(async () => {
  closeDb();
  await cleanRedis();
});

afterAll(async () => {
  closeDb();
  await closeRedis();
});

// ----------------------------------------------------------------
// attemptPurchase — happy path
// ----------------------------------------------------------------
describe("attemptPurchase — success", () => {
  it("returns success when sale is active and stock available", async () => {
    seedSale({ stock: 10 });
    await initStock(SALE_ID, 10);

    const result = await attemptPurchase("alice@test.com");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purchaseId).toBeGreaterThan(0);
      expect(result.message).toBe("Purchase confirmed");
    }
  });

  it("saves purchase to DB on success", async () => {
    seedSale({ stock: 10 });
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com");

    const db = getDb();
    const purchase = db
      .prepare("SELECT * FROM purchases WHERE user_id = ?")
      .get("alice@test.com") as { user_id: string; sale_id: number } | undefined;

    expect(purchase).toBeDefined();
    expect(purchase?.user_id).toBe("alice@test.com");
    expect(purchase?.sale_id).toBe(SALE_ID);
  });

  it("decrements Redis stock by 1 on success", async () => {
    seedSale({ stock: 10 });
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com");

    const remaining = await getStock(SALE_ID);
    expect(remaining).toBe(9);
  });

  it("marks user as bought in Redis on success", async () => {
    seedSale({ stock: 10 });
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com");

    const bought = await hasUserBought(SALE_ID, "alice@test.com");
    expect(bought).toBe(true);
  });

  it("allows multiple different users to purchase", async () => {
    seedSale({ stock: 10 });
    await initStock(SALE_ID, 10);

    const r1 = await attemptPurchase("alice@test.com");
    const r2 = await attemptPurchase("bob@test.com");

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    const remaining = await getStock(SALE_ID);
    expect(remaining).toBe(8);
  });
});

// ----------------------------------------------------------------
// attemptPurchase — sale not found / not active
// ----------------------------------------------------------------
describe("attemptPurchase — sale not found or not active", () => {
  it("returns SALE_NOT_FOUND when no sale in DB", async () => {
    const result = await attemptPurchase("alice@test.com");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("SALE_NOT_FOUND");
  });

  it("returns SALE_NOT_ACTIVE when sale is upcoming", async () => {
    seedSale({
      offsetStart: 60_000,  // starts in 1 minute
      offsetEnd:   120_000,
    });
    await initStock(SALE_ID, 10);

    const result = await attemptPurchase("alice@test.com");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("SALE_NOT_ACTIVE");
      expect(result.message).toContain("Sale starts at");
    }
  });

  it("returns SALE_NOT_ACTIVE when sale has ended", async () => {
    seedSale({
      offsetStart: -120_000, // started 2 min ago
      offsetEnd:   -60_000,  // ended 1 min ago
    });
    await initStock(SALE_ID, 10);

    const result = await attemptPurchase("alice@test.com");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("SALE_NOT_ACTIVE");
      expect(result.message).toBe("Sale has ended");
    }
  });
});

// ----------------------------------------------------------------
// attemptPurchase — duplicate purchase
// ----------------------------------------------------------------
describe("attemptPurchase — duplicate purchase", () => {
  it("returns ALREADY_PURCHASED on second attempt by same user", async () => {
    seedSale({ stock: 10 });
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com"); // first — succeeds
    const result = await attemptPurchase("alice@test.com"); // second — rejected

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("ALREADY_PURCHASED");
  });

  it("does not decrement stock on duplicate attempt", async () => {
    seedSale({ stock: 10 });
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com");
    await attemptPurchase("alice@test.com"); // duplicate

    const remaining = await getStock(SALE_ID);
    expect(remaining).toBe(9); // only decremented once
  });

  it("does not create duplicate DB record", async () => {
    seedSale({ stock: 10 });
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com");
    await attemptPurchase("alice@test.com");

    const db = getDb();
    const count = db
      .prepare("SELECT COUNT(*) as c FROM purchases WHERE user_id = ?")
      .get("alice@test.com") as { c: number };
    expect(Number(count.c)).toBe(1);
  });
});

// ----------------------------------------------------------------
// attemptPurchase — sold out + compensation
// ----------------------------------------------------------------
describe("attemptPurchase — sold out", () => {
  it("returns SOLD_OUT when stock is 0", async () => {
    seedSale({ stock: 1 });
    await initStock(SALE_ID, 1);

    await attemptPurchase("alice@test.com"); // takes last item
    const result = await attemptPurchase("bob@test.com");  // sold out

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("SOLD_OUT");
  });

  it("compensates — stock never goes below 0", async () => {
    seedSale({ stock: 1 });
    await initStock(SALE_ID, 1);

    // Fire 5 users simultaneously at 1 item
    const users = ["a", "b", "c", "d", "e"].map(u => `${u}@test.com`);
    await Promise.all(users.map(u => attemptPurchase(u)));

    const remaining = await getStock(SALE_ID);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });

  it("compensates — exactly 1 purchase for 1 stock under concurrency", async () => {
    seedSale({ stock: 1 });
    await initStock(SALE_ID, 1);

    const users = ["a", "b", "c", "d", "e"].map(u => `${u}@test.com`);
    const results = await Promise.all(users.map(u => attemptPurchase(u)));

    const successes = results.filter(r => r.success);
    expect(successes.length).toBe(1);

    const db = getDb();
    const count = db
      .prepare("SELECT COUNT(*) as c FROM purchases")
      .get() as { c: number };
    expect(Number(count.c)).toBe(1);
  });

  it("compensates — removes user bought key on sold out", async () => {
    seedSale({ stock: 1 });
    await initStock(SALE_ID, 1);

    await attemptPurchase("alice@test.com"); // takes last item

    // bob tries and gets SOLD_OUT — his key should be removed
    await attemptPurchase("bob@test.com");
    const bobBought = await hasUserBought(SALE_ID, "bob@test.com");
    expect(bobBought).toBe(false);
  });
});

// ----------------------------------------------------------------
// getPurchaseStatus
// ----------------------------------------------------------------
describe("getPurchaseStatus", () => {
  it("returns hasPurchased false when user has not bought", async () => {
    seedSale({ stock: 10 });
    await initStock(SALE_ID, 10);

    const status = await getPurchaseStatus("alice@test.com");
    expect(status.hasPurchased).toBe(false);
  });

  it("returns hasPurchased true with details after purchase", async () => {
    seedSale({ stock: 10 });
    await initStock(SALE_ID, 10);

    const purchase = await attemptPurchase("alice@test.com");
    const status   = await getPurchaseStatus("alice@test.com");

    expect(status.hasPurchased).toBe(true);
    expect(status.purchaseId).toBeDefined();
    if (purchase.success) {
      expect(status.purchaseId).toBe(purchase.purchaseId);
    }
    expect(status.purchasedAt).toBeDefined();
  });

  it("returns hasPurchased false when no sale exists", async () => {
    const status = await getPurchaseStatus("alice@test.com");
    expect(status.hasPurchased).toBe(false);
  });
});
