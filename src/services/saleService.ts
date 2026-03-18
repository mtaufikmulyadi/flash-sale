/**
 * Sale Service
 *
 * Pure functions — no HTTP, no routes.
 * Talks to DB and Redis only.
 * Easy to unit test by mocking both.
 */

import { getDb, type Sale } from "../db/client";
import { getRedis, RedisKeys, initStock } from "../cache/redis";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export type SaleStatus = "upcoming" | "active" | "ended" | "sold_out";

export type SaleState = {
  id: number;
  product_name: string;
  total_stock: number;
  remaining_stock: number | null;
  status: SaleStatus;
  start_time: string;
  end_time: string;
};

// ----------------------------------------------------------------
// isSaleActive — checks server time against sale window
// Always uses server time — never trust client clock
// ----------------------------------------------------------------

export function isSaleActive(sale: Sale): boolean {
  const now = Date.now();
  const start = new Date(sale.start_time).getTime();
  const end = new Date(sale.end_time).getTime();
  return now >= start && now <= end;
}

export function isSaleUpcoming(sale: Sale): boolean {
  return Date.now() < new Date(sale.start_time).getTime();
}

export function isSaleEnded(sale: Sale): boolean {
  return Date.now() > new Date(sale.end_time).getTime();
}

// ----------------------------------------------------------------
// getSaleStatus — derives status from server time
// ----------------------------------------------------------------

export function getSaleStatus(sale: Sale): SaleStatus {
  if (isSaleUpcoming(sale)) return "upcoming";
  if (isSaleEnded(sale))    return "ended";
  return "active";
}

// ----------------------------------------------------------------
// getActiveSale — fetches the current sale from DB
// Returns null if no sale exists
// ----------------------------------------------------------------

export function getActiveSale(): Sale | null {
  const db = getDb();
  const sale = db
    .prepare(`SELECT * FROM sales ORDER BY id DESC LIMIT 1`)
    .get() as Sale | undefined;
  return sale ?? null;
}

// ----------------------------------------------------------------
// getSaleState — full state including live Redis stock count
// This is what GET /api/sale returns
// ----------------------------------------------------------------

export async function getSaleState(): Promise<SaleState | null> {
  const sale = getActiveSale();
  if (!sale) return null;

  const r = getRedis();
  const stockKey = RedisKeys.saleStock(sale.id);
  const raw = await r.get(stockKey);
  const remaining = raw === null ? null : parseInt(raw, 10);

  const status = getSaleStatus(sale);

  return {
    id:              sale.id,
    product_name:    sale.product_name,
    total_stock:     sale.total_stock,
    remaining_stock: remaining,
    status,
    start_time:      sale.start_time,
    end_time:        sale.end_time,
  };
}

// ----------------------------------------------------------------
// initialiseSaleStock — seeds Redis stock counter from DB value
// Called once when a sale becomes active or on server startup
// ----------------------------------------------------------------

export async function initialiseSaleStock(saleId: number): Promise<void> {
  const db = getDb();
  const sale = db
    .prepare(`SELECT * FROM sales WHERE id = ?`)
    .get(saleId) as Sale | undefined;

  if (!sale) throw new Error(`Sale ${saleId} not found`);

  await initStock(saleId, sale.total_stock);
}
