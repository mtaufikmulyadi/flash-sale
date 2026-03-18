/**
 * STEP 1 TESTS — Database + Redis connectivity
 * Uses node:sqlite (built-in, Node 22+) — no native compilation needed
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";

process.env.DB_PATH = ":memory:";

import { getDb, closeDb, type Sale, type Purchase } from "../../src/db/client";
import {
  getRedis,
  closeRedis,
  RedisKeys,
  initStock,
  getStock,
  markUserBought,
  decrementStock,
  incrementStock,
  unmarkUserBought,
  hasUserBought,
} from "../../src/cache/redis";

// ----------------------------------------------------------------
// DATABASE TESTS
// ----------------------------------------------------------------
describe("Database — schema and basic operations", () => {
  beforeEach(() => {
    closeDb();
  });

  afterAll(() => {
    closeDb();
  });

  it("connects and initialises schema without error", () => {
    expect(() => getDb()).not.toThrow();
  });

  it("can insert a sale record", () => {
    const db = getDb();
    const result = db
      .prepare(
        `INSERT INTO sales (product_name, total_stock, start_time, end_time)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        "Test Sneaker",
        10,
        new Date(Date.now() + 60_000).toISOString(),
        new Date(Date.now() + 3_600_000).toISOString()
      );

    expect(Number(result.lastInsertRowid)).toBe(1);
    expect(result.changes).toBe(1);
  });

  it("can read a sale back with correct default status", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run("Test Sneaker", 10, "2099-01-01T00:00:00.000Z", "2099-01-01T01:00:00.000Z");

    const sale = db.prepare("SELECT * FROM sales WHERE id = 1").get() as Sale;
    expect(sale.product_name).toBe("Test Sneaker");
    expect(sale.total_stock).toBe(10);
    expect(sale.status).toBe("upcoming");
  });

  it("can insert a purchase record", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run("Test Sneaker", 10, "2099-01-01T00:00:00.000Z", "2099-01-01T01:00:00.000Z");

    const result = db
      .prepare(`INSERT INTO purchases (user_id, sale_id) VALUES (?, ?)`)
      .run("alice@test.com", 1);

    expect(result.changes).toBe(1);
  });

  it("can read a purchase back with correct default status", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run("Test Sneaker", 10, "2099-01-01T00:00:00.000Z", "2099-01-01T01:00:00.000Z");
    db.prepare(`INSERT INTO purchases (user_id, sale_id) VALUES (?, ?)`).run(
      "alice@test.com", 1
    );

    const purchase = db
      .prepare("SELECT * FROM purchases WHERE user_id = ?")
      .get("alice@test.com") as Purchase;

    expect(purchase.user_id).toBe("alice@test.com");
    expect(purchase.sale_id).toBe(1);
    expect(purchase.status).toBe("confirmed");
  });

  it("rejects duplicate purchase for same user + sale (UNIQUE constraint)", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run("Test Sneaker", 10, "2099-01-01T00:00:00.000Z", "2099-01-01T01:00:00.000Z");
    db.prepare(`INSERT INTO purchases (user_id, sale_id) VALUES (?, ?)`).run(
      "alice@test.com", 1
    );

    expect(() => {
      db.prepare(`INSERT INTO purchases (user_id, sale_id) VALUES (?, ?)`).run(
        "alice@test.com", 1
      );
    }).toThrow(/UNIQUE constraint failed/);
  });

  it("allows different users to purchase the same sale", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run("Test Sneaker", 10, "2099-01-01T00:00:00.000Z", "2099-01-01T01:00:00.000Z");

    db.prepare(`INSERT INTO purchases (user_id, sale_id) VALUES (?, ?)`).run(
      "alice@test.com", 1
    );
    const result = db
      .prepare(`INSERT INTO purchases (user_id, sale_id) VALUES (?, ?)`)
      .run("bob@test.com", 1);

    expect(result.changes).toBe(1);

    const row = db
      .prepare("SELECT COUNT(*) as c FROM purchases")
      .get() as { c: number };
    expect(Number(row.c)).toBe(2);
  });
});

// ----------------------------------------------------------------
// REDIS TESTS
// ----------------------------------------------------------------
describe("Redis — connectivity and key helpers", () => {
  const TEST_SALE_ID = 99;

  beforeAll(async () => {
    const r = getRedis();
    await r.connect().catch(() => {});
    const keys = await r.keys(`sale:${TEST_SALE_ID}:*`);
    if (keys.length) await r.del(...keys);
  });

  afterAll(async () => {
    const r = getRedis();
    const keys = await r.keys(`sale:${TEST_SALE_ID}:*`);
    if (keys.length) await r.del(...keys);
    await closeRedis();
  });

  it("RedisKeys.saleStock produces correct key string", () => {
    expect(RedisKeys.saleStock(1)).toBe("sale:1:stock");
    expect(RedisKeys.saleStock(42)).toBe("sale:42:stock");
  });

  it("RedisKeys.userBought produces correct key string", () => {
    expect(RedisKeys.userBought(1, "alice@test.com")).toBe(
      "sale:1:user:alice@test.com:bought"
    );
  });

  it("can SET and GET a value", async () => {
    const r = getRedis();
    await r.set("test:ping", "pong");
    const val = await r.get("test:ping");
    expect(val).toBe("pong");
    await r.del("test:ping");
  });

  it("initStock sets the stock counter", async () => {
    await initStock(TEST_SALE_ID, 10);
    const stock = await getStock(TEST_SALE_ID);
    expect(stock).toBe(10);
  });

  it("decrementStock reduces counter and returns new value", async () => {
    await initStock(TEST_SALE_ID, 10);
    const after = await decrementStock(TEST_SALE_ID);
    expect(after).toBe(9);
  });

  it("incrementStock restores counter by 1", async () => {
    await initStock(TEST_SALE_ID, 5);
    await decrementStock(TEST_SALE_ID);
    await incrementStock(TEST_SALE_ID);
    const stock = await getStock(TEST_SALE_ID);
    expect(stock).toBe(5);
  });

  it("getStock returns null when key does not exist", async () => {
    const stock = await getStock(9999);
    expect(stock).toBeNull();
  });

  it("markUserBought returns true on first call", async () => {
    const result = await markUserBought(TEST_SALE_ID, "alice@test.com");
    expect(result).toBe(true);
  });

  it("markUserBought returns false on second call (already bought)", async () => {
    const result = await markUserBought(TEST_SALE_ID, "alice@test.com");
    expect(result).toBe(false);
  });

  it("hasUserBought returns true after markUserBought", async () => {
    await markUserBought(TEST_SALE_ID, "bob@test.com");
    const result = await hasUserBought(TEST_SALE_ID, "bob@test.com");
    expect(result).toBe(true);
  });

  it("hasUserBought returns false for unknown user", async () => {
    const result = await hasUserBought(TEST_SALE_ID, "nobody@test.com");
    expect(result).toBe(false);
  });

  it("unmarkUserBought removes the key (compensation step)", async () => {
    await markUserBought(TEST_SALE_ID, "carol@test.com");
    await unmarkUserBought(TEST_SALE_ID, "carol@test.com");
    const result = await hasUserBought(TEST_SALE_ID, "carol@test.com");
    expect(result).toBe(false);
  });
});
