/**
 * Purchase Service — two-step flow
 *
 * Step 1: attemptPurchase()  → reserves slot → status="pending"
 * Step 2: processPayment()   → confirms or cancels reservation
 *
 * Reservation expires after 10 minutes via Redis TTL.
 * If TTL expires without payment, stock slot is held until
 * explicit release — document this as a known limitation.
 */

import { getDb } from "../db/client";
import {
  markUserBought, decrementStock, incrementStock,
  unmarkUserBought, hasUserBought,
  createReservation, getReservation, deleteReservation,
} from "../cache/redis";
import { getActiveSale, isSaleActive } from "./saleService";

// ── Types ─────────────────────────────────────────────────────
export type PurchaseResult =
  | { success: true;  purchaseId: number; reservedUntil: string; message: string }
  | { success: false; code: PurchaseErrorCode; message: string };

export type PaymentResult =
  | { success: true;  status: "confirmed" | "cancelled"; message: string }
  | { success: false; code: PaymentErrorCode; message: string };

export type PurchaseErrorCode =
  | "SALE_NOT_FOUND" | "SALE_NOT_ACTIVE"
  | "ALREADY_PURCHASED" | "SOLD_OUT" | "DB_ERROR";

export type PaymentErrorCode =
  | "RESERVATION_NOT_FOUND" | "RESERVATION_EXPIRED"
  | "ALREADY_PROCESSED" | "DB_ERROR";

// ── Step 1: Reserve slot ──────────────────────────────────────
export async function attemptPurchase(userId: string): Promise<PurchaseResult> {
  const sale = getActiveSale();

  if (!sale) return { success: false, code: "SALE_NOT_FOUND", message: "No sale found" };

  if (!isSaleActive(sale)) {
    const now   = Date.now();
    const start = new Date(sale.start_time).getTime();
    return {
      success: false, code: "SALE_NOT_ACTIVE",
      message: now < start ? `Sale starts at ${sale.start_time}` : "Sale has ended",
    };
  }

  // SETNX — dedup check
  const isNew = await markUserBought(sale.id, userId);
  if (!isNew) {
    return { success: false, code: "ALREADY_PURCHASED", message: "You have already reserved or purchased an item" };
  }

  // DECR — reserve stock slot
  const remaining = await decrementStock(sale.id);
  if (remaining < 0) {
    await Promise.all([incrementStock(sale.id), unmarkUserBought(sale.id, userId)]);
    return { success: false, code: "SOLD_OUT", message: "Sorry, this item is sold out" };
  }

  // Create reservation key with 10-min TTL
  const reservedUntil = await createReservation(sale.id, userId);

  // Insert pending purchase in DB
  try {
    const db     = getDb();
    const result = db
      .prepare(
        `INSERT INTO purchases (user_id, sale_id, status, reserved_until)
         VALUES (?, ?, 'pending', ?)`
      )
      .run(userId, sale.id, reservedUntil);

    return {
      success: true,
      purchaseId:   Number(result.lastInsertRowid),
      reservedUntil,
      message: "Item reserved. Complete payment within 10 minutes.",
    };
  } catch {
    await Promise.all([
      incrementStock(sale.id),
      unmarkUserBought(sale.id, userId),
      deleteReservation(sale.id, userId),
    ]);
    return { success: false, code: "DB_ERROR", message: "Reservation could not be saved. Please try again." };
  }
}

// ── Step 2: Process payment ───────────────────────────────────
export async function processPayment(
  userId: string,
  action: "pay" | "cancel"
): Promise<PaymentResult> {
  const sale = getActiveSale();
  if (!sale) return { success: false, code: "RESERVATION_NOT_FOUND", message: "No active sale" };

  const db = getDb();

  // Check DB first — catches already-processed purchases before Redis check
  const purchase = db
    .prepare(`SELECT * FROM purchases WHERE user_id = ? AND sale_id = ?`)
    .get(userId, sale.id) as { id: number; status: string } | undefined;

  if (!purchase) {
    return { success: false, code: "RESERVATION_NOT_FOUND", message: "No reservation found" };
  }

  if (purchase.status !== "pending") {
    return { success: false, code: "ALREADY_PROCESSED", message: "This purchase has already been processed" };
  }

  // Check reservation key still exists in Redis (TTL check)
  const reservation = await getReservation(sale.id, userId);
  if (!reservation) {
    return {
      success: false,
      code:    "RESERVATION_EXPIRED",
      message: "Your reservation has expired. The item has been released.",
    };
  }

  if (action === "pay") {
    const paymentId = `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    db.prepare(
      `UPDATE purchases SET status = 'confirmed', payment_id = ? WHERE id = ?`
    ).run(paymentId, purchase.id);

    await deleteReservation(sale.id, userId);

    return {
      success: true,
      status:  "confirmed",
      message: `Payment confirmed. Reference: ${paymentId}`,
    };
  } else {
    // Cancel — delete the DB record entirely so user can retry
    db.prepare(`DELETE FROM purchases WHERE id = ?`).run(purchase.id);

    await Promise.all([
      incrementStock(sale.id),
      unmarkUserBought(sale.id, userId),
      deleteReservation(sale.id, userId),
    ]);

    return { success: true, status: "cancelled", message: "Reservation cancelled. Your slot has been released." };
  }
}

// ── Status check ──────────────────────────────────────────────
export async function getPurchaseStatus(userId: string): Promise<{
  hasPurchased: boolean;
  status?: "pending" | "confirmed" | "cancelled" | "expired";
  purchaseId?: number;
  purchasedAt?: string;
  reservedUntil?: string;
  paymentId?: string;
}> {
  const sale = getActiveSale();
  if (!sale) return { hasPurchased: false };

  const bought = await hasUserBought(sale.id, userId);
  if (!bought) return { hasPurchased: false };

  const db = getDb();
  const purchase = db
    .prepare(
      `SELECT id, status, purchased_at, reserved_until, payment_id
       FROM purchases WHERE user_id = ? AND sale_id = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId, sale.id) as {
      id: number; status: string; purchased_at: string;
      reserved_until: string; payment_id: string | null;
    } | undefined;

  if (!purchase) return { hasPurchased: false };

  return {
    hasPurchased:  true,
    status:        purchase.status as "pending" | "confirmed" | "cancelled" | "expired",
    purchaseId:    purchase.id,
    purchasedAt:   purchase.purchased_at,
    reservedUntil: purchase.reserved_until,
    paymentId:     purchase.payment_id ?? undefined,
  };
}
