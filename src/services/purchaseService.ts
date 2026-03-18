/**
 * Purchase Service
 *
 * The heart of the flash sale system.
 * Handles the atomic buy flow:
 *   1. Check sale is active (server time)
 *   2. SETNX  — mark user as bought (dedup)
 *   3. DECR   — reserve a stock slot
 *   4. INSERT — write confirmed purchase to DB
 *
 * If any step after SETNX fails, we compensate:
 *   INCR stock back + DEL user key
 * so the system stays consistent.
 */

import { getDb } from "../db/client";
import {
  markUserBought,
  decrementStock,
  incrementStock,
  unmarkUserBought,
  hasUserBought,
} from "../cache/redis";
import { getActiveSale, isSaleActive } from "./saleService";

// ----------------------------------------------------------------
// Result types — explicit instead of throwing for control flow
// ----------------------------------------------------------------

export type PurchaseResult =
  | { success: true;  purchaseId: number; message: string }
  | { success: false; code: PurchaseErrorCode; message: string };

export type PurchaseErrorCode =
  | "SALE_NOT_FOUND"
  | "SALE_NOT_ACTIVE"
  | "ALREADY_PURCHASED"
  | "SOLD_OUT"
  | "DB_ERROR";

// ----------------------------------------------------------------
// attemptPurchase — the main function
// Called by POST /api/purchase after auth + validation middleware
// ----------------------------------------------------------------

export async function attemptPurchase(userId: string): Promise<PurchaseResult> {
  // ── Gate 1: sale exists and is within time window ──────────────
  const sale = getActiveSale();

  if (!sale) {
    return {
      success: false,
      code:    "SALE_NOT_FOUND",
      message: "No sale found",
    };
  }

  if (!isSaleActive(sale)) {
    const now = Date.now();
    const start = new Date(sale.start_time).getTime();
    const msg = now < start
      ? `Sale starts at ${sale.start_time}`
      : "Sale has ended";
    return {
      success: false,
      code:    "SALE_NOT_ACTIVE",
      message: msg,
    };
  }

  // ── Gate 2: SETNX — has this user already bought? ──────────────
  // Returns true  = key was new     → user hasn't bought, continue
  // Returns false = key already set → user already bought, reject
  const isNew = await markUserBought(sale.id, userId);

  if (!isNew) {
    return {
      success: false,
      code:    "ALREADY_PURCHASED",
      message: "You have already purchased an item in this sale",
    };
  }

  // ── Gate 3: DECR — atomically reserve a stock slot ─────────────
  // Returns new stock value — if negative, we're oversold
  const remaining = await decrementStock(sale.id);

  if (remaining < 0) {
    // ── Compensation: undo both Redis operations ──────────────────
    // Run in parallel — both must succeed to keep state consistent
    await Promise.all([
      incrementStock(sale.id),         // restore the counter
      unmarkUserBought(sale.id, userId), // remove the user key
    ]);

    return {
      success: false,
      code:    "SOLD_OUT",
      message: "Sorry, this item is sold out",
    };
  }

  // ── Gate 4: write confirmed purchase to DB ─────────────────────
  try {
    const db = getDb();
    const result = db
      .prepare(`INSERT INTO purchases (user_id, sale_id) VALUES (?, ?)`)
      .run(userId, sale.id);

    return {
      success:    true,
      purchaseId: Number(result.lastInsertRowid),
      message:    "Purchase confirmed",
    };
  } catch (err) {
    // DB write failed — compensate Redis so user can retry
    await Promise.all([
      incrementStock(sale.id),
      unmarkUserBought(sale.id, userId),
    ]);

    return {
      success: false,
      code:    "DB_ERROR",
      message: "Purchase could not be saved. Please try again.",
    };
  }
}

// ----------------------------------------------------------------
// getPurchaseStatus — check if a user has purchased in this sale
// Called by GET /api/purchase/:userId
// ----------------------------------------------------------------

export async function getPurchaseStatus(userId: string): Promise<{
  hasPurchased: boolean;
  purchaseId?: number;
  purchasedAt?: string;
}> {
  // Check Redis first (fast path)
  const sale = getActiveSale();
  if (!sale) return { hasPurchased: false };

  const bought = await hasUserBought(sale.id, userId);
  if (!bought) return { hasPurchased: false };

  // Confirm from DB and get details
  const db = getDb();
  const purchase = db
    .prepare(
      `SELECT id, purchased_at FROM purchases
       WHERE user_id = ? AND sale_id = ? AND status = 'confirmed'`
    )
    .get(userId, sale.id) as { id: number; purchased_at: string } | undefined;

  if (!purchase) return { hasPurchased: false };

  return {
    hasPurchased: true,
    purchaseId:   purchase.id,
    purchasedAt:  purchase.purchased_at,
  };
}
