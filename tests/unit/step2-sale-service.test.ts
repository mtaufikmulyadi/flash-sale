/**
 * STEP 2 TESTS — Sale service logic
 *
 * Tests every time-based branch:
 *  - upcoming  → now is before start_time
 *  - active    → now is within the window
 *  - ended     → now is after end_time
 *  - edge cases → exactly on the boundary
 *
 * No Redis needed for pure time logic tests.
 * Redis only needed for getSaleState() tests.
 */

import { describe, it, expect, beforeEach, afterAll } from "@jest/globals";

process.env.DB_PATH = ":memory:";

import { getDb, closeDb, type Sale } from "../../src/db/client";
import { closeRedis, initStock } from "../../src/cache/redis";
import {
  isSaleActive,
  isSaleUpcoming,
  isSaleEnded,
  getSaleStatus,
  getActiveSale,
  getSaleState,
  initialiseSaleStock,
} from "../../src/services/saleService";

// ----------------------------------------------------------------
// Helpers — build fake Sale objects with controlled times
// ----------------------------------------------------------------

const NOW = Date.now();

function makeSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id:           1,
    product_name: "Test Sneaker",
    total_stock:  10,
    start_time:   new Date(NOW - 10_000).toISOString(), // 10s ago
    end_time:     new Date(NOW + 60_000).toISOString(), // 60s from now
    status:       "active",
    created_at:   new Date(NOW - 60_000).toISOString(),
    ...overrides,
  };
}

// ----------------------------------------------------------------
// isSaleActive
// ----------------------------------------------------------------
describe("isSaleActive", () => {
  it("returns true when current time is within the sale window", () => {
    const sale = makeSale();
    expect(isSaleActive(sale)).toBe(true);
  });

  it("returns false when sale has not started yet", () => {
    const sale = makeSale({
      start_time: new Date(NOW + 60_000).toISOString(),
      end_time:   new Date(NOW + 120_000).toISOString(),
    });
    expect(isSaleActive(sale)).toBe(false);
  });

  it("returns false when sale has ended", () => {
    const sale = makeSale({
      start_time: new Date(NOW - 120_000).toISOString(),
      end_time:   new Date(NOW - 60_000).toISOString(),
    });
    expect(isSaleActive(sale)).toBe(false);
  });

  it("returns true exactly at start_time boundary", () => {
    const sale = makeSale({
      start_time: new Date(NOW - 1).toISOString(), // 1ms ago
      end_time:   new Date(NOW + 60_000).toISOString(),
    });
    expect(isSaleActive(sale)).toBe(true);
  });

  it("returns false exactly after end_time boundary", () => {
    const sale = makeSale({
      start_time: new Date(NOW - 120_000).toISOString(),
      end_time:   new Date(NOW - 1).toISOString(), // 1ms ago
    });
    expect(isSaleActive(sale)).toBe(false);
  });
});

// ----------------------------------------------------------------
// isSaleUpcoming
// ----------------------------------------------------------------
describe("isSaleUpcoming", () => {
  it("returns true when sale is in the future", () => {
    const sale = makeSale({
      start_time: new Date(NOW + 60_000).toISOString(),
      end_time:   new Date(NOW + 120_000).toISOString(),
    });
    expect(isSaleUpcoming(sale)).toBe(true);
  });

  it("returns false when sale is active", () => {
    expect(isSaleUpcoming(makeSale())).toBe(false);
  });

  it("returns false when sale has ended", () => {
    const sale = makeSale({
      start_time: new Date(NOW - 120_000).toISOString(),
      end_time:   new Date(NOW - 60_000).toISOString(),
    });
    expect(isSaleUpcoming(sale)).toBe(false);
  });
});

// ----------------------------------------------------------------
// isSaleEnded
// ----------------------------------------------------------------
describe("isSaleEnded", () => {
  it("returns true when sale end_time has passed", () => {
    const sale = makeSale({
      start_time: new Date(NOW - 120_000).toISOString(),
      end_time:   new Date(NOW - 60_000).toISOString(),
    });
    expect(isSaleEnded(sale)).toBe(true);
  });

  it("returns false when sale is active", () => {
    expect(isSaleEnded(makeSale())).toBe(false);
  });

  it("returns false when sale is upcoming", () => {
    const sale = makeSale({
      start_time: new Date(NOW + 60_000).toISOString(),
      end_time:   new Date(NOW + 120_000).toISOString(),
    });
    expect(isSaleEnded(sale)).toBe(false);
  });
});

// ----------------------------------------------------------------
// getSaleStatus
// ----------------------------------------------------------------
describe("getSaleStatus", () => {
  it("returns 'upcoming' for a future sale", () => {
    const sale = makeSale({
      start_time: new Date(NOW + 60_000).toISOString(),
      end_time:   new Date(NOW + 120_000).toISOString(),
    });
    expect(getSaleStatus(sale)).toBe("upcoming");
  });

  it("returns 'active' for a currently running sale", () => {
    expect(getSaleStatus(makeSale())).toBe("active");
  });

  it("returns 'ended' for a past sale", () => {
    const sale = makeSale({
      start_time: new Date(NOW - 120_000).toISOString(),
      end_time:   new Date(NOW - 60_000).toISOString(),
    });
    expect(getSaleStatus(sale)).toBe("ended");
  });
});

// ----------------------------------------------------------------
// getActiveSale — reads from DB
// ----------------------------------------------------------------
describe("getActiveSale", () => {
  beforeEach(() => {
    closeDb();
  });

  afterAll(() => {
    closeDb();
  });

  it("returns null when no sale exists", () => {
    const sale = getActiveSale();
    expect(sale).toBeNull();
  });

  it("returns the most recent sale", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run(
      "Test Sneaker", 10,
      new Date(NOW - 10_000).toISOString(),
      new Date(NOW + 60_000).toISOString()
    );

    const sale = getActiveSale();
    expect(sale).not.toBeNull();
    expect(sale?.product_name).toBe("Test Sneaker");
    expect(sale?.total_stock).toBe(10);
  });

  it("returns the latest sale when multiple exist", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run("Old Sale", 5,
      new Date(NOW - 200_000).toISOString(),
      new Date(NOW - 100_000).toISOString()
    );
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run("New Sale", 20,
      new Date(NOW - 10_000).toISOString(),
      new Date(NOW + 60_000).toISOString()
    );

    const sale = getActiveSale();
    expect(sale?.product_name).toBe("New Sale");
  });
});

// ----------------------------------------------------------------
// getSaleState — reads DB + Redis together
// ----------------------------------------------------------------
describe("getSaleState", () => {
  beforeEach(async () => {
    closeDb();
    // Clean up any Redis keys from previous tests
    const r = (await import("../../src/cache/redis")).getRedis();
    const keys = await r.keys("sale:*");
    if (keys.length) await r.del(...keys);
  });

  afterAll(async () => {
    closeDb();
    await closeRedis();
  });

  it("returns null when no sale in DB", async () => {
    const state = await getSaleState();
    expect(state).toBeNull();
  });

  it("returns full state with stock from Redis", async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run(
      "Test Sneaker", 10,
      new Date(NOW - 10_000).toISOString(),
      new Date(NOW + 60_000).toISOString()
    );

    // Seed Redis stock
    await initStock(1, 10);

    const state = await getSaleState();
    expect(state).not.toBeNull();
    expect(state?.product_name).toBe("Test Sneaker");
    expect(state?.total_stock).toBe(10);
    expect(state?.remaining_stock).toBe(10);
    expect(state?.status).toBe("active");
  });

  it("returns null remaining_stock when Redis key missing", async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run(
      "Test Sneaker", 10,
      new Date(NOW - 10_000).toISOString(),
      new Date(NOW + 60_000).toISOString()
    );
    // Don't seed Redis — simulate key missing

    const state = await getSaleState();
    expect(state?.remaining_stock).toBeNull();
  });

  it("returns correct status for upcoming sale", async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run(
      "Future Sneaker", 10,
      new Date(NOW + 60_000).toISOString(),
      new Date(NOW + 120_000).toISOString()
    );

    const state = await getSaleState();
    expect(state?.status).toBe("upcoming");
  });
});

// ----------------------------------------------------------------
// initialiseSaleStock
// ----------------------------------------------------------------
describe("initialiseSaleStock", () => {
  beforeEach(() => {
    closeDb();
  });

  afterAll(async () => {
    closeDb();
    await closeRedis();
  });

  it("seeds Redis with the sale's total_stock", async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time)
       VALUES (?, ?, ?, ?)`
    ).run(
      "Test Sneaker", 15,
      new Date(NOW - 10_000).toISOString(),
      new Date(NOW + 60_000).toISOString()
    );

    await initialiseSaleStock(1);

    const r = (await import("../../src/cache/redis")).getRedis();
    const val = await r.get("sale:1:stock");
    expect(Number(val)).toBe(15);
  });

  it("throws if sale does not exist", async () => {
    await expect(initialiseSaleStock(9999)).rejects.toThrow("Sale 9999 not found");
  });
});
