/**
 * STEP 6 — Stress test
 *
 * Fires N concurrent POST /api/purchase requests at a sale with
 * a fixed stock count. Proves the system never oversells.
 *
 * Run with:  npm run test:stress
 * Requires:  backend running on localhost:3000
 *            Redis running on localhost:6379
 *            A seeded sale in the DB
 *
 * What it asserts:
 *   - Exactly `stock` purchases recorded in DB
 *   - Exactly `stock` 201 responses received
 *   - Zero duplicate purchases (UNIQUE constraint never fires)
 *   - Redis stock counter ends at exactly 0
 *   - Server stays alive throughout (health check passes after load)
 */

import { getDb, closeDb }   from "../../src/db/client";
import { getRedis, closeRedis } from "../../src/cache/redis";
import { buildApp }          from "../../src/app";
import { seedSale }          from "../../src/db/seed";
import { FastifyInstance }   from "fastify";
import { generateToken }     from "../../src/services/authService";

// ── Config ────────────────────────────────────────────────────
const CONCURRENT_USERS = 500;
const STOCK            = 10;

// ── Colours ───────────────────────────────────────────────────
const G = "\x1b[32m"; const R = "\x1b[31m";
const Y = "\x1b[33m"; const B = "\x1b[36m";
const D = "\x1b[2m";  const X = "\x1b[0m";

function ok(msg: string)   { console.log(`  ${G}✓${X}  ${msg}`); }
function fail(msg: string) { console.log(`  ${R}✗${X}  ${msg}`); }
function info(msg: string) { console.log(`  ${B}→${X}  ${msg}`); }
function dim(msg: string)  { console.log(`  ${D}${msg}${X}`); }

// ── Result counters ───────────────────────────────────────────
type Results = {
  status201: number;
  status409: number;
  status410: number;
  status400: number;
  status429: number;
  other:     number;
  errors:    number;
};

// ── Main ──────────────────────────────────────────────────────
async function run() {
  console.log();
  console.log(`  ${B}Flash Sale — Stress Test${X}`);
  console.log(`  ${D}${CONCURRENT_USERS} concurrent users · ${STOCK} items in stock${X}`);
  console.log();

  // ── Setup ────────────────────────────────────────────────────
  process.env.DB_PATH    = ":memory:";
  process.env.JWT_SECRET = "stress-test-secret";
  process.env.NODE_ENV   = "test";

  info("Building app...");
  const app: FastifyInstance = await buildApp();
  await app.ready();

  info(`Seeding sale with stock=${STOCK}, starting NOW...`);
  // Start immediately (0ms offset) so sale is active right away
  await seedSale({ stock: STOCK, startOffsetMs: 0, durationMs: 60 * 60_000 });
  ok("Sale seeded and active");

  // ── Generate tokens for all users ────────────────────────────
  info(`Generating ${CONCURRENT_USERS} user tokens...`);
  const users = Array.from(
    { length: CONCURRENT_USERS },
    (_, i) => `user-${i}@stress-test.com`
  );
  const tokens = users.map(u => `Bearer ${generateToken(u)}`);

  // ── Fire all requests simultaneously ─────────────────────────
  info(`Firing ${CONCURRENT_USERS} concurrent purchase requests...`);
  const start = Date.now();

  const responses = await Promise.allSettled(
    tokens.map(token =>
      app.inject({
        method:  "POST",
        url:     "/api/purchase",
        headers: { authorization: token },
      })
    )
  );

  const duration = Date.now() - start;
  info(`All requests completed in ${duration}ms`);
  console.log();

  // ── Tally results ─────────────────────────────────────────────
  const counts: Results = {
    status201: 0, status409: 0, status410: 0,
    status400: 0, status429: 0, other: 0, errors: 0,
  };

  for (const r of responses) {
    if (r.status === "rejected") { counts.errors++; continue; }
    const s = r.value.statusCode;
    if      (s === 201) counts.status201++;
    else if (s === 409) counts.status409++;
    else if (s === 410) counts.status410++;
    else if (s === 400) counts.status400++;
    else if (s === 429) counts.status429++;
    else                counts.other++;
  }

  // ── Print response breakdown ──────────────────────────────────
  console.log(`  ${Y}Response breakdown:${X}`);
  dim(`    201 Confirmed:    ${counts.status201}`);
  dim(`    409 Already bought: ${counts.status409}`);
  dim(`    410 Sold out:     ${counts.status410}`);
  dim(`    400 Not active:   ${counts.status400}`);
  dim(`    429 Rate limited: ${counts.status429}`);
  dim(`    Other:            ${counts.other}`);
  dim(`    Errors:           ${counts.errors}`);
  console.log();

  // ── Assertions ────────────────────────────────────────────────
  console.log(`  ${Y}Assertions:${X}`);
  let passed = 0;
  let failed = 0;

  function assert(label: string, condition: boolean, detail?: string) {
    if (condition) {
      ok(label);
      passed++;
    } else {
      fail(`${label}${detail ? ` — ${detail}` : ""}`);
      failed++;
    }
  }

  // 1. Exactly STOCK successful purchases
  assert(
    `Exactly ${STOCK} confirmed purchases (201s)`,
    counts.status201 === STOCK,
    `got ${counts.status201}`
  );

  // 2. DB purchase count matches
  const db = getDb();
  const dbCount = (
    db.prepare("SELECT COUNT(*) as c FROM purchases").get() as { c: number }
  ).c;
  assert(
    `DB has exactly ${STOCK} purchase records`,
    Number(dbCount) === STOCK,
    `got ${dbCount}`
  );

  // 3. No duplicate purchases in DB
  const dupCount = (
    db.prepare(
      `SELECT COUNT(*) as c FROM (
         SELECT user_id FROM purchases GROUP BY user_id HAVING COUNT(*) > 1
       )`
    ).get() as { c: number }
  ).c;
  assert(
    "Zero duplicate purchases in DB",
    Number(dupCount) === 0,
    `found ${dupCount} duplicates`
  );

  // 4. Redis stock counter ends at 0
  const r = getRedis();
  const saleId = (db.prepare("SELECT id FROM sales LIMIT 1").get() as { id: number }).id;
  const redisStock = await r.get(`sale:${saleId}:stock`);
  assert(
    "Redis stock counter = 0 after all purchases",
    redisStock === "0",
    `got ${redisStock}`
  );

  // 5. Total responses = total users
  const totalResponses = responses.filter(r => r.status === "fulfilled").length;
  assert(
    `All ${CONCURRENT_USERS} requests received a response`,
    totalResponses === CONCURRENT_USERS,
    `got ${totalResponses}`
  );

  // 6. 201 + 409 + 410 = total users (no unexplained responses)
  const accounted = counts.status201 + counts.status409 + counts.status410 +
                    counts.status400 + counts.status429;
  assert(
    "All responses are accounted for (no unexpected status codes)",
    counts.other === 0,
    `${counts.other} unexpected responses`
  );

  // 7. Server still alive after load
  const health = await app.inject({ method: "GET", url: "/health" });
  assert(
    "Server still healthy after load",
    health.statusCode === 200
  );

  // ── Summary ───────────────────────────────────────────────────
  console.log();
  console.log(`  ${"─".repeat(48)}`);
  if (failed === 0) {
    console.log(`  ${G}All ${passed} assertions passed ✓${X}`);
    console.log(`  ${D}${CONCURRENT_USERS} users · ${STOCK} items · ${duration}ms · zero oversell${X}`);
  } else {
    console.log(`  ${R}${failed} assertion(s) failed${X}`);
    console.log(`  ${G}${passed} passed${X}`);
  }
  console.log();

  // ── Cleanup ───────────────────────────────────────────────────
  closeDb();
  await closeRedis();
  await app.close();

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("Stress test crashed:", err);
  process.exit(1);
});
