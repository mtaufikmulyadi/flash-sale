import axios from "axios";

const api = axios.create({ baseURL: "/" });

let authToken: string | null = null;

export function setToken(token: string) {
  authToken = token;
  api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
}
export function clearToken() {
  authToken = null;
  delete api.defaults.headers.common["Authorization"];
}
export function getToken() { return authToken; }

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
  hasPurchased:   boolean;
  status?:        "pending" | "confirmed" | "cancelled" | "expired";
  purchaseId?:    number;
  purchasedAt?:   string;
  reservedUntil?: string;
  paymentId?:     string;
};

export async function fetchToken(userId: string): Promise<string> {
  const res = await api.post("/auth/token", { userId });
  return res.data.token;
}

export async function fetchSale(): Promise<SaleState> {
  const res = await api.get("/api/sale");
  return res.data;
}

export async function purchase(): Promise<{
  purchaseId: number;
  reservedUntil: string;
  message: string;
}> {
  const res = await api.post("/api/purchase");
  return res.data;
}

export async function pay(): Promise<{ status: string; message: string }> {
  const res = await api.post("/api/payment", { action: "pay" });
  return res.data;
}

export async function cancelPurchase(): Promise<{ status: string; message: string }> {
  const res = await api.post("/api/payment", { action: "cancel" });
  return res.data;
}

export async function fetchPurchaseStatus(userId: string): Promise<PurchaseStatus> {
  const res = await api.get(`/api/purchase/${encodeURIComponent(userId)}`);
  return res.data;
}

export async function fetchAdminSale(): Promise<SaleState | null> {
  try {
    const res = await api.get("/admin/sale");
    return res.data;
  } catch { return null; }
}

export async function createSale(data: {
  productName: string;
  stock:       number;
  startTime:   string;
  endTime:     string;
}): Promise<{ saleId: number; message: string }> {
  const res = await api.post("/admin/sale", data);
  return res.data;
}
