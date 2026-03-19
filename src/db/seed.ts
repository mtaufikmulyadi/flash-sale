/**
 * Seed script
 *
 * Safe to run multiple times — clears existing sales and Redis
 * keys before creating a fresh sale. Prevents stale stock counts.
 */

import { getDb } from "./client";
import { getRedis } from "../cache/redis";
import { initialiseSaleStock } from "../services/saleService";

export async function seedSale(options?: {
  stock?: number;
  startOffsetMs?: number;
  durationMs?: number;
}): Promise<number> {
  const db = getDb();

  const stock       = options?.stock         ?? 10;
  const startOffset = options?.startOffsetMs ?? 60_000;
  const duration    = options?.durationMs    ?? 30 * 60_000;

  const startTime = new Date(Date.now() + startOffset).toISOString();
  const endTime   = new Date(Date.now() + startOffset + duration).toISOString();

  // ── 1. Flush all existing Redis sale keys ──────────────────
  const r = getRedis();
  const existingKeys = await r.keys("sale:*");
  if (existingKeys.length) {
    await r.del(...existingKeys);
    console.log(`Cleared ${existingKeys.length} Redis sale keys`);
  }

  // ── 2. Clear existing sales and purchases from DB ──────────
  db.exec("DELETE FROM purchases");
  db.exec("DELETE FROM sales");
  console.log("Cleared existing sales and purchases from DB");

  // ── 3. Insert fresh sale ───────────────────────────────────
  const result = db
    .prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time, status)
       VALUES (?, ?, ?, ?, 'upcoming')`
    )
    .run("Limited Edition Sneaker", stock, startTime, endTime);

  const saleId = Number(result.lastInsertRowid);

  // ── 4. Seed Redis stock counter ────────────────────────────
  await initialiseSaleStock(saleId);

  console.log(`✓ Sale created  id=${saleId} stock=${stock}`);
  console.log(`  Starts at: ${startTime}`);
  console.log(`  Ends at:   ${endTime}`);

  return saleId;
}

if (require.main === module) {
  seedSale()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}