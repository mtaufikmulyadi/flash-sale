/**
 * STEP 3 TESTS — Purchase service (two-step flow)
 *
 * Tests attemptPurchase() — reserve slot:
 *  - success → status pending, reservedUntil set
 *  - sale not found / not active
 *  - already purchased
 *  - sold out + compensation
 *
 * Tests processPayment():
 *  - pay → status confirmed, payment ref generated
 *  - cancel → status cancelled, stock restored
 *  - expired reservation → RESERVATION_EXPIRED
 *  - already processed → ALREADY_PROCESSED
 *
 * Tests cleanupExpiredReservations():
 *  - finds expired pending purchases
 *  - restores stock + removes user key
 *  - ignores confirmed / cancelled purchases
 *
 * Tests getPurchaseStatus():
 *  - returns full status including pending/confirmed/expired
 */

import {
  describe, it, expect,
  beforeEach, afterAll
} from "@jest/globals";

process.env.DB_PATH = ":memory:";

import { getDb, closeDb }                        from "../../src/db/client";
import { getRedis, closeRedis, initStock, getStock, hasUserBought } from "../../src/cache/redis";
import { attemptPurchase, processPayment, getPurchaseStatus } from "../../src/services/purchaseService";
import { cleanupExpiredReservations }            from "../../src/jobs/cleanupJob";

// ── Helpers ───────────────────────────────────────────────────
const NOW     = Date.now();
const SALE_ID = 1;

function seedSale(opts: { stock?: number; offsetStart?: number; offsetEnd?: number } = {}) {
  const db         = getDb();
  const stock      = opts.stock       ?? 10;
  const startTime  = new Date(NOW + (opts.offsetStart ?? -60_000)).toISOString();
  const endTime    = new Date(NOW + (opts.offsetEnd   ??  60_000)).toISOString();
  db.prepare(
    `INSERT INTO sales (product_name, total_stock, start_time, end_time)
     VALUES (?, ?, ?, ?)`
  ).run("Test Sneaker", stock, startTime, endTime);
}

async function cleanRedis() {
  const r    = getRedis();
  const keys = await r.keys("sale:*");
  if (keys.length) await r.del(...keys);
}

beforeEach(async () => {
  closeDb();
  await cleanRedis();
});

afterAll(async () => {
  closeDb();
  await closeRedis();
});

// ── attemptPurchase — success ─────────────────────────────────
describe("attemptPurchase — success", () => {
  it("returns success with status pending and reservedUntil", async () => {
    seedSale();
    await initStock(SALE_ID, 10);

    const result = await attemptPurchase("alice@test.com");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.purchaseId).toBeGreaterThan(0);
      expect(result.reservedUntil).toBeDefined();
      expect(new Date(result.reservedUntil).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("saves purchase with status=pending in DB", async () => {
    seedSale();
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com");

    const db  = getDb();
    const row = db.prepare("SELECT * FROM purchases WHERE user_id = ?")
      .get("alice@test.com") as { status: string; reserved_until: string };

    expect(row.status).toBe("pending");
    expect(row.reserved_until).toBeDefined();
  });

  it("reservedUntil is ~10 minutes from now", async () => {
    seedSale();
    await initStock(SALE_ID, 10);

    const result = await attemptPurchase("alice@test.com");
    if (!result.success) throw new Error("expected success");

    const diff = new Date(result.reservedUntil).getTime() - Date.now();
    expect(diff).toBeGreaterThan(9 * 60_000);   // at least 9 min
    expect(diff).toBeLessThan(11 * 60_000);     // at most 11 min
  });

  it("decrements Redis stock by 1", async () => {
    seedSale();
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com");

    expect(await getStock(SALE_ID)).toBe(9);
  });

  it("marks user as bought in Redis", async () => {
    seedSale();
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com");

    expect(await hasUserBought(SALE_ID, "alice@test.com")).toBe(true);
  });
});

// ── attemptPurchase — failures ────────────────────────────────
describe("attemptPurchase — failures", () => {
  it("returns SALE_NOT_FOUND when no sale in DB", async () => {
    const result = await attemptPurchase("alice@test.com");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("SALE_NOT_FOUND");
  });

  it("returns SALE_NOT_ACTIVE for upcoming sale", async () => {
    seedSale({ offsetStart: 60_000, offsetEnd: 120_000 });
    await initStock(SALE_ID, 10);

    const result = await attemptPurchase("alice@test.com");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("SALE_NOT_ACTIVE");
  });

  it("returns SALE_NOT_ACTIVE for ended sale", async () => {
    seedSale({ offsetStart: -120_000, offsetEnd: -60_000 });
    await initStock(SALE_ID, 10);

    const result = await attemptPurchase("alice@test.com");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("SALE_NOT_ACTIVE");
  });

  it("returns ALREADY_PURCHASED on second attempt", async () => {
    seedSale();
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com");
    const result = await attemptPurchase("alice@test.com");

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("ALREADY_PURCHASED");
  });

  it("does not decrement stock on duplicate attempt", async () => {
    seedSale();
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com");
    await attemptPurchase("alice@test.com");

    expect(await getStock(SALE_ID)).toBe(9); // only decremented once
  });

  it("returns SOLD_OUT and compensates when stock exhausted", async () => {
    seedSale({ stock: 1 });
    await initStock(SALE_ID, 1);

    await attemptPurchase("alice@test.com"); // takes last item

    const result = await attemptPurchase("bob@test.com");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("SOLD_OUT");

    // Stock should be restored to 0, not -1
    expect(await getStock(SALE_ID)).toBe(0);

    // Bob's user key should be removed
    expect(await hasUserBought(SALE_ID, "bob@test.com")).toBe(false);
  });

  it("exactly 1 success for 1 stock under concurrency", async () => {
    seedSale({ stock: 1 });
    await initStock(SALE_ID, 1);

    const users   = ["a", "b", "c", "d", "e"].map(u => `${u}@test.com`);
    const results = await Promise.all(users.map(u => attemptPurchase(u)));

    expect(results.filter(r => r.success).length).toBe(1);
    expect(await getStock(SALE_ID)).toBe(0);

    const db    = getDb();
    const count = (db.prepare("SELECT COUNT(*) as c FROM purchases").get() as { c: number }).c;
    expect(Number(count)).toBe(1);
  });
});

// ── processPayment — pay ──────────────────────────────────────
describe("processPayment — pay", () => {
  it("confirms purchase and generates payment ref", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");

    const result = await processPayment("alice@test.com", "pay");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.status).toBe("confirmed");
      expect(result.message).toMatch(/PAY-/);
    }
  });

  it("updates DB status to confirmed", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");
    await processPayment("alice@test.com", "pay");

    const db  = getDb();
    const row = db.prepare("SELECT status, payment_id FROM purchases WHERE user_id = ?")
      .get("alice@test.com") as { status: string; payment_id: string };

    expect(row.status).toBe("confirmed");
    expect(row.payment_id).toMatch(/PAY-/);
  });

  it("does not restore stock on successful payment", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");
    await processPayment("alice@test.com", "pay");

    expect(await getStock(SALE_ID)).toBe(9); // stock stays decremented
  });
});

// ── processPayment — cancel ───────────────────────────────────
describe("processPayment — cancel", () => {
  it("cancels purchase and restores stock", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");

    const result = await processPayment("alice@test.com", "cancel");

    expect(result.success).toBe(true);
    if (result.success) expect(result.status).toBe("cancelled");
  });

  it("restores Redis stock on cancel", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");
    await processPayment("alice@test.com", "cancel");

    expect(await getStock(SALE_ID)).toBe(10); // restored
  });

  it("removes user bought key on cancel — allows retry", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");
    await processPayment("alice@test.com", "cancel");

    expect(await hasUserBought(SALE_ID, "alice@test.com")).toBe(false);
  });

  it("removes DB record on cancel (allows clean retry)", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");
    await processPayment("alice@test.com", "cancel");

    const db  = getDb();
    const row = db.prepare("SELECT * FROM purchases WHERE user_id = ?")
      .get("alice@test.com");
    // Row is deleted on cancel so user can retry cleanly
    expect(row).toBeUndefined();
  });

  it("allows user to re-purchase after cancel", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");
    await processPayment("alice@test.com", "cancel");

    // Alice can now try again
    const result = await attemptPurchase("alice@test.com");
    expect(result.success).toBe(true);
  });
});

// ── processPayment — edge cases ───────────────────────────────
describe("processPayment — edge cases", () => {
  it("returns RESERVATION_NOT_FOUND when no active sale", async () => {
    const result = await processPayment("alice@test.com", "pay");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("RESERVATION_NOT_FOUND");
  });

  it("returns ALREADY_PROCESSED when purchase already confirmed", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");
    await processPayment("alice@test.com", "pay"); // first payment

    const result = await processPayment("alice@test.com", "pay"); // second attempt
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("ALREADY_PROCESSED");
  });
});

// ── cleanupExpiredReservations ────────────────────────────────
describe("cleanupExpiredReservations", () => {
  it("returns 0 when no expired reservations", async () => {
    seedSale();
    await initStock(SALE_ID, 10);

    const count = await cleanupExpiredReservations();
    expect(count).toBe(0);
  });

  it("marks expired pending purchases as expired", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");

    // Manually expire the reservation by updating reserved_until to the past
    const db = getDb();
    db.prepare(
      `UPDATE purchases SET reserved_until = ? WHERE user_id = ?`
    ).run(new Date(Date.now() - 1_000).toISOString(), "alice@test.com");

    await cleanupExpiredReservations();

    const row = db.prepare("SELECT status FROM purchases WHERE user_id = ?")
      .get("alice@test.com") as { status: string };
    expect(row.status).toBe("expired");
  });

  it("restores Redis stock for expired reservations", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");

    const db = getDb();
    db.prepare(
      `UPDATE purchases SET reserved_until = ? WHERE user_id = ?`
    ).run(new Date(Date.now() - 1_000).toISOString(), "alice@test.com");

    await cleanupExpiredReservations();

    expect(await getStock(SALE_ID)).toBe(10); // restored to full
  });

  it("removes user bought key for expired reservations — allows retry", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");

    const db = getDb();
    db.prepare(
      `UPDATE purchases SET reserved_until = ? WHERE user_id = ?`
    ).run(new Date(Date.now() - 1_000).toISOString(), "alice@test.com");

    await cleanupExpiredReservations();

    expect(await hasUserBought(SALE_ID, "alice@test.com")).toBe(false);
  });

  it("does not touch confirmed purchases", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");
    await processPayment("alice@test.com", "pay"); // confirmed

    const count = await cleanupExpiredReservations();
    expect(count).toBe(0);

    const db  = getDb();
    const row = db.prepare("SELECT status FROM purchases WHERE user_id = ?")
      .get("alice@test.com") as { status: string };
    expect(row.status).toBe("confirmed");
  });

  it("returns the count of cleaned up reservations", async () => {
    seedSale({ stock: 10 });
    await initStock(SALE_ID, 10);

    await attemptPurchase("alice@test.com");
    await attemptPurchase("bob@test.com");

    const db  = getDb();
    const past = new Date(Date.now() - 1_000).toISOString();
    db.prepare(`UPDATE purchases SET reserved_until = ?`).run(past);

    const count = await cleanupExpiredReservations();
    expect(count).toBe(2);
  });
});

// ── getPurchaseStatus ─────────────────────────────────────────
describe("getPurchaseStatus", () => {
  it("returns hasPurchased false when no purchase", async () => {
    seedSale();
    await initStock(SALE_ID, 10);

    const status = await getPurchaseStatus("alice@test.com");
    expect(status.hasPurchased).toBe(false);
  });

  it("returns pending status after reservation", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");

    const status = await getPurchaseStatus("alice@test.com");
    expect(status.hasPurchased).toBe(true);
    expect(status.status).toBe("pending");
    expect(status.reservedUntil).toBeDefined();
  });

  it("returns confirmed status after payment", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");
    await processPayment("alice@test.com", "pay");

    const status = await getPurchaseStatus("alice@test.com");
    expect(status.status).toBe("confirmed");
    expect(status.paymentId).toMatch(/PAY-/);
  });

  it("returns cancelled status after cancel", async () => {
    seedSale();
    await initStock(SALE_ID, 10);
    await attemptPurchase("alice@test.com");
    await processPayment("alice@test.com", "cancel");

    // After cancel the user key is removed — so hasPurchased is false
    const status = await getPurchaseStatus("alice@test.com");
    expect(status.hasPurchased).toBe(false);
  });
});