/**
 * Seed script — configurable via CLI args
 *
 * Usage:
 *   npx ts-node src/db/seed.ts                          # defaults: starts in 1min, 30min duration, stock 10
 *   npx ts-node src/db/seed.ts --stock 50               # custom stock
 *   npx ts-node src/db/seed.ts --start "2024-06-01T14:00:00Z" --end "2024-06-01T14:30:00Z" --stock 100
 *   npx ts-node src/db/seed.ts --in 5 --duration 60     # starts in 5 min, lasts 60 min
 *   npx ts-node src/db/seed.ts --now                    # starts immediately (for testing)
 *
 * Args:
 *   --start    ISO 8601 start time        e.g. "2024-06-01T14:00:00Z"
 *   --end      ISO 8601 end time          e.g. "2024-06-01T14:30:00Z"
 *   --in       minutes from now to start  e.g. 5  (default: 1)
 *   --duration minutes the sale lasts     e.g. 60 (default: 30)
 *   --stock    number of items            e.g. 50 (default: 10)
 *   --now      start immediately (alias for --in 0)
 *   --product  product name               e.g. "Air Max 90"
 */

import { getDb } from "./client";
import { getRedis } from "../cache/redis";
import { initialiseSaleStock } from "../services/saleService";

// ── CLI arg parser ────────────────────────────────────────────
function parseArgs(argv: string[]): {
  start?:    string;
  end?:      string;
  inMins?:   number;
  duration?: number;
  stock?:    number;
  now?:      boolean;
  product?:  string;
} {
  const args: Record<string, string> = {};
  const flags: Record<string, boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        args[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    }
  }

  return {
    start:    args["start"],
    end:      args["end"],
    inMins:   args["in"]       ? Number(args["in"])       : undefined,
    duration: args["duration"] ? Number(args["duration"]) : undefined,
    stock:    args["stock"]    ? Number(args["stock"])     : undefined,
    now:      flags["now"],
    product:  args["product"],
  };
}

// ── Validation ────────────────────────────────────────────────
function validateArgs(opts: ReturnType<typeof parseArgs>) {
  if (opts.stock !== undefined && (isNaN(opts.stock) || opts.stock < 1)) {
    throw new Error("--stock must be a positive integer");
  }
  if (opts.inMins !== undefined && (isNaN(opts.inMins) || opts.inMins < 0)) {
    throw new Error("--in must be a non-negative number");
  }
  if (opts.duration !== undefined && (isNaN(opts.duration) || opts.duration < 1)) {
    throw new Error("--duration must be a positive number");
  }
  if (opts.start && isNaN(new Date(opts.start).getTime())) {
    throw new Error(`--start "${opts.start}" is not a valid ISO 8601 date`);
  }
  if (opts.end && isNaN(new Date(opts.end).getTime())) {
    throw new Error(`--end "${opts.end}" is not a valid ISO 8601 date`);
  }
  if (opts.start && opts.end) {
    if (new Date(opts.end) <= new Date(opts.start)) {
      throw new Error("--end must be after --start");
    }
  }
}

// ── Main seed function ────────────────────────────────────────
export async function seedSale(options?: {
  stock?:         number;
  startOffsetMs?: number;
  durationMs?:    number;
  startTime?:     string;
  endTime?:       string;
  productName?:   string;
}): Promise<number> {
  const db = getDb();

  const stock       = options?.stock       ?? 10;
  const productName = options?.productName ?? "Limited Edition Sneaker";

  // Determine start/end times
  let startTime: string;
  let endTime:   string;

  if (options?.startTime && options?.endTime) {
    startTime = options.startTime;
    endTime   = options.endTime;
  } else {
    const startOffset = options?.startOffsetMs ?? 60_000;
    const duration    = options?.durationMs    ?? 30 * 60_000;
    startTime = new Date(Date.now() + startOffset).toISOString();
    endTime   = new Date(Date.now() + startOffset + duration).toISOString();
  }

  // ── 1. Flush all existing Redis sale keys ─────────────────
  const r = getRedis();
  const existingKeys = await r.keys("sale:*");
  if (existingKeys.length) {
    await r.del(...existingKeys);
    console.log(`  Cleared ${existingKeys.length} Redis sale keys`);
  }

  // ── 2. Clear existing sales and purchases from DB ─────────
  db.exec("DELETE FROM purchases");
  db.exec("DELETE FROM sales");
  console.log("  Cleared existing sales and purchases from DB");

  // ── 3. Insert fresh sale ──────────────────────────────────
  const result = db
    .prepare(
      `INSERT INTO sales (product_name, total_stock, start_time, end_time, status)
       VALUES (?, ?, ?, ?, 'upcoming')`
    )
    .run(productName, stock, startTime, endTime);

  const saleId = Number(result.lastInsertRowid);

  // ── 4. Seed Redis stock counter ───────────────────────────
  await initialiseSaleStock(saleId);

  return saleId;
}

// ── CLI entry point ───────────────────────────────────────────
if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));

  // Show help
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`
Usage:
  npx ts-node src/db/seed.ts [options]

Options:
  --stock <n>       Number of items available (default: 10)
  --in <mins>       Start in N minutes from now (default: 1)
  --duration <mins> Sale duration in minutes (default: 30)
  --start <iso>     Exact start time as ISO 8601 string
  --end <iso>       Exact end time as ISO 8601 string
  --now             Start the sale immediately
  --product <name>  Product name (default: "Limited Edition Sneaker")

Examples:
  npx ts-node src/db/seed.ts
  npx ts-node src/db/seed.ts --stock 50 --in 5 --duration 60
  npx ts-node src/db/seed.ts --now --stock 100
  npx ts-node src/db/seed.ts --start "2024-06-01T14:00:00Z" --end "2024-06-01T14:30:00Z" --stock 200
  npx ts-node src/db/seed.ts --product "Air Max 90" --stock 25 --in 2
    `);
    process.exit(0);
  }

  try {
    validateArgs(opts);
  } catch (err: any) {
    console.error(`\n  Error: ${err.message}`);
    console.error("  Run with --help to see usage.\n");
    process.exit(1);
  }

  // Resolve timing
  let startOffsetMs = 60_000; // default 1 min
  let durationMs    = 30 * 60_000; // default 30 min
  let startTime: string | undefined;
  let endTime:   string | undefined;

  if (opts.start && opts.end) {
    startTime = opts.start;
    endTime   = opts.end;
  } else {
    if (opts.now)      startOffsetMs = 0;
    else if (opts.inMins !== undefined) startOffsetMs = opts.inMins * 60_000;
    if (opts.duration) durationMs = opts.duration * 60_000;
  }

  const stock       = opts.stock   ?? 10;
  const productName = opts.product ?? "Limited Edition Sneaker";

  console.log(`\n  Flash Sale — Seed`);
  console.log(`  ${"─".repeat(40)}`);

  seedSale({ stock, startOffsetMs, durationMs, startTime, endTime, productName })
    .then((saleId) => {
      const resolvedStart = startTime ?? new Date(Date.now() + startOffsetMs).toISOString();
      const resolvedEnd   = endTime   ?? new Date(Date.now() + startOffsetMs + durationMs).toISOString();

      console.log(`\n  ✓ Sale created`);
      console.log(`    id:      ${saleId}`);
      console.log(`    product: ${productName}`);
      console.log(`    stock:   ${stock}`);
      console.log(`    starts:  ${resolvedStart}`);
      console.log(`    ends:    ${resolvedEnd}`);
      console.log();
      process.exit(0);
    })
    .catch((err) => {
      console.error("\n  Seed failed:", err.message);
      process.exit(1);
    });
}