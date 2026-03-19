/**
 * API client
 *
 * All backend calls live here — no fetch/axios scattered in components.
 * Token is stored in memory (not localStorage) — simpler and safer for
 * this project scope.
 */

import axios from "axios";

const api = axios.create({ baseURL: "/" });

// ── In-memory token store ─────────────────────────────────────
let authToken: string | null = null;

export function setToken(token: string) {
  authToken = token;
  // Attach to every subsequent request automatically
  api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
}

export function clearToken() {
  authToken = null;
  delete api.defaults.headers.common["Authorization"];
}

export function getToken() {
  return authToken;
}

// ── Types ─────────────────────────────────────────────────────
export type SaleState = {
  id: number;
  product_name: string;
  total_stock: number;
  remaining_stock: number | null;
  status: "upcoming" | "active" | "ended";
  start_time: string;
  end_time: string;
};

export type PurchaseStatus = {
  hasPurchased: boolean;
  purchaseId?: number;
  purchasedAt?: string;
};

// ── API calls ─────────────────────────────────────────────────

// Get a JWT token for a userId (dev endpoint)
export async function fetchToken(userId: string): Promise<string> {
  const res = await api.post("/auth/token", { userId });
  return res.data.token;
}

// Get current sale state — polled every 5s by the frontend
export async function fetchSale(): Promise<SaleState> {
  const res = await api.get("/api/sale");
  return res.data;
}

// Attempt to purchase
export async function purchase(): Promise<{ purchaseId: number; message: string }> {
  const res = await api.post("/api/purchase");
  return res.data;
}

// Check if current user has already purchased
export async function fetchPurchaseStatus(userId: string): Promise<PurchaseStatus> {
  const res = await api.get(`/api/purchase/${encodeURIComponent(userId)}`);
  return res.data;
}
