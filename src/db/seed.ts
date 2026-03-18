import { getDb } from "./client";

// ----------------------------------------------------------------
// Seeds a single flash sale starting 1 minute from now
// Run with: npx ts-node src/db/seed.ts
// ----------------------------------------------------------------
export function seedSale(options?: {
  stock?: number;
  startOffsetMs?: number; // how many ms from now the sale starts
  durationMs?: number;    // how long the sale lasts
}): number {
  const db = getDb();

  const stock        = options?.stock          ?? 10;
  const startOffset  = options?.startOffsetMs  ?? 60_000;     // 1 min from now
  const duration     = options?.durationMs     ?? 30 * 60_000; // 30 min

  const startTime = new Date(Date.now() + startOffset).toISOString();
  const endTime   = new Date(Date.now() + startOffset + duration).toISOString();

  const result = db
    .prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time, status)
       VALUES (?, ?, ?, ?, 'upcoming')`
    )
    .run("Limited Edition Sneaker", stock, startTime, endTime);

  console.log(`Seeded sale id=${result.lastInsertRowid} stock=${stock}`);
  return result.lastInsertRowid as number;
}

// Only run directly (not when imported by tests)
if (require.main === module) {
  seedSale();
  process.exit(0);
}
