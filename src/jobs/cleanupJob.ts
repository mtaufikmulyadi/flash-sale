/**
 * Reservation cleanup job
 *
 * Runs every 60 seconds. Finds purchases with status="pending"
 * whose reserved_until has passed, then:
 *   1. Marks them as "expired" in DB
 *   2. Restores Redis stock counter (INCR)
 *   3. Removes user bought key (DEL) so user can retry
 *
 * This handles the case where a user closes the browser
 * without paying or explicitly cancelling.
 *
 * Why not use Redis keyspace notifications?
 *   Keyspace notifications require enabling notify-keyspace-events
 *   on the Redis server and add complexity. A polling job is simpler,
 *   predictable, and works out of the box with no Redis config changes.
 *   The worst case delay is 60 seconds — acceptable for a 10-min window.
 */

import { getDb }             from "../db/client";
import { getActiveSale }     from "../services/saleService";
import { incrementStock, unmarkUserBought } from "../cache/redis";

type ExpiredPurchase = {
  id:      number;
  user_id: string;
  sale_id: number;
};

let jobInterval: NodeJS.Timeout | null = null;

// ── Run one cleanup pass ───────────────────────────────────────
export async function cleanupExpiredReservations(): Promise<number> {
  const db   = getDb();
  const now  = new Date().toISOString();

  // Find all pending purchases whose reservation window has passed
  const expired = db
    .prepare(
      `SELECT id, user_id, sale_id FROM purchases
       WHERE status = 'pending' AND reserved_until < ?`
    )
    .all(now) as ExpiredPurchase[];

  if (expired.length === 0) return 0;

  console.log(`[cleanup] Found ${expired.length} expired reservation(s) — restoring stock`);

  for (const purchase of expired) {
    try {
      // 1. Mark as expired in DB
      db.prepare(`UPDATE purchases SET status = 'expired' WHERE id = ?`)
        .run(purchase.id);

      // 2. Restore Redis stock counter
      await incrementStock(purchase.sale_id);

      // 3. Remove user bought key — allows user to retry
      await unmarkUserBought(purchase.sale_id, purchase.user_id);

      console.log(`[cleanup] Restored slot for user=${purchase.user_id} sale=${purchase.sale_id}`);
    } catch (err) {
      console.error(`[cleanup] Failed to restore slot for purchase ${purchase.id}:`, err);
    }
  }

  return expired.length;
}

// ── Start the background job ───────────────────────────────────
export function startCleanupJob(intervalMs = 60_000): void {
  if (jobInterval) return; // already running

  console.log(`[cleanup] Starting reservation cleanup job (every ${intervalMs / 1000}s)`);

  // Run immediately on startup to catch any reservations that
  // expired while the server was down
  cleanupExpiredReservations().catch(console.error);

  jobInterval = setInterval(() => {
    cleanupExpiredReservations().catch(console.error);
  }, intervalMs);

  // Don't let this interval block Node from exiting
  if (jobInterval.unref) jobInterval.unref();
}

// ── Stop the job (used in tests) ───────────────────────────────
export function stopCleanupJob(): void {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
  }
}
