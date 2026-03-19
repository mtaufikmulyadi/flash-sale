/**
 * PurchaseForm
 *
 * Two-step UI:
 *  1. Enter userId → get JWT → show Buy Now button
 *  2. Click Buy Now → call /api/purchase → show result
 *
 * Result states:
 *  - success     → green confirmation
 *  - 409         → "already purchased"
 *  - 410         → "sold out"
 *  - 400         → "sale not active"
 *  - 401         → "auth error"
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchToken, purchase, fetchPurchaseStatus,
  setToken, getToken, type PurchaseStatus,
} from "../api";

type PurchaseResult =
  | { type: "success";  purchaseId: number }
  | { type: "already" }
  | { type: "soldout" }
  | { type: "inactive"; message: string }
  | { type: "error";    message: string };

export function PurchaseForm({ saleStatus }: { saleStatus?: string }) {
  const [userId, setUserId]       = useState("");
  const [loggedIn, setLoggedIn]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState<PurchaseResult | null>(null);
  const [loginError, setLoginError] = useState("");

  // Once logged in, check if user already purchased
  const { data: purchaseStatus } = useQuery<PurchaseStatus>({
    queryKey:  ["purchaseStatus", userId],
    queryFn:   () => fetchPurchaseStatus(userId),
    enabled:   loggedIn && !result,
    refetchInterval: 5_000,
    retry: false,
  });

  // ── Step 1: get token ──────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim()) return;
    setLoading(true);
    setLoginError("");
    try {
      const token = await fetchToken(userId.trim());
      setToken(token);
      setLoggedIn(true);
    } catch {
      setLoginError("Could not authenticate. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: attempt purchase ───────────────────────────────
  async function handlePurchase() {
    if (!getToken()) return;
    setLoading(true);
    setResult(null);
    try {
      const data = await purchase();
      setResult({ type: "success", purchaseId: data.purchaseId });
    } catch (err: any) {
      const code    = err?.response?.data?.error;
      const message = err?.response?.data?.message ?? "Something went wrong";
      if (code === "ALREADY_PURCHASED") setResult({ type: "already" });
      else if (code === "SOLD_OUT")     setResult({ type: "soldout" });
      else if (code === "SALE_NOT_ACTIVE" || code === "SALE_NOT_FOUND")
        setResult({ type: "inactive", message });
      else
        setResult({ type: "error", message });
    } finally {
      setLoading(false);
    }
  }

  // ── Render: not logged in ──────────────────────────────────
  if (!loggedIn) {
    return (
      <div style={styles.card}>
        <h3 style={styles.heading}>Enter your ID to participate</h3>
        <form onSubmit={handleLogin} style={{ display: "flex", gap: 8 }}>
          <input
            value={userId}
            onChange={e => setUserId(e.target.value)}
            placeholder="your@email.com"
            style={styles.input}
            disabled={loading}
          />
          <button type="submit" style={styles.btn("#3b82f6")} disabled={loading || !userId.trim()}>
            {loading ? "..." : "Continue"}
          </button>
        </form>
        {loginError && <p style={styles.errorText}>{loginError}</p>}
      </div>
    );
  }

  // ── Render: already purchased (from status check) ─────────
  if (purchaseStatus?.hasPurchased && !result) {
    return (
      <div style={styles.card}>
        <ResultBox type="already" purchaseId={purchaseStatus.purchaseId} />
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
          Logged in as <strong>{userId}</strong>
        </p>
      </div>
    );
  }

  // ── Render: result after purchase attempt ─────────────────
  if (result) {
    return (
      <div style={styles.card}>
        <ResultBox {...result} />
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
          Logged in as <strong>{userId}</strong>
        </p>
      </div>
    );
  }

  // ── Render: buy now button ─────────────────────────────────
  const isActive = saleStatus === "active";
  return (
    <div style={styles.card}>
      <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>
        Logged in as <strong style={{ color: "#111827" }}>{userId}</strong>
      </p>
      <button
        onClick={handlePurchase}
        disabled={loading || !isActive}
        style={styles.btn(isActive ? "#3b82f6" : "#9ca3af")}
      >
        {loading ? "Processing..." : isActive ? "Buy Now" : "Sale not active"}
      </button>
      {!isActive && (
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
          The button will activate when the sale opens.
        </p>
      )}
    </div>
  );
}

// ── Result feedback box ────────────────────────────────────
function ResultBox(props: PurchaseResult & { purchaseId?: number }) {
  if (props.type === "success") return (
    <div style={styles.resultBox("#22c55e")}>
      <strong>Purchase confirmed!</strong> Your order #{props.purchaseId} has been placed.
    </div>
  );
  if (props.type === "already") return (
    <div style={styles.resultBox("#3b82f6")}>
      <strong>Already purchased.</strong> You already have an item from this sale
      {props.purchaseId ? ` (order #${props.purchaseId})` : ""}.
    </div>
  );
  if (props.type === "soldout") return (
    <div style={styles.resultBox("#ef4444")}>
      <strong>Sold out.</strong> All items have been claimed.
    </div>
  );
  if (props.type === "inactive") return (
    <div style={styles.resultBox("#f59e0b")}>
      <strong>Sale not active.</strong> {props.message}
    </div>
  );
  return (
    <div style={styles.resultBox("#ef4444")}>
      <strong>Error.</strong> {props.message}
    </div>
  );
}

const styles = {
  card: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: "20px 24px",
  } as React.CSSProperties,
  heading: {
    fontSize: 16,
    fontWeight: 600,
    margin: "0 0 12px",
    color: "#111827",
  } as React.CSSProperties,
  input: {
    flex: 1,
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 14,
    outline: "none",
  } as React.CSSProperties,
  btn: (bg: string) => ({
    background: bg,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "8px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    width: "100%",
  } as React.CSSProperties),
  errorText: {
    color: "#ef4444",
    fontSize: 13,
    marginTop: 8,
  } as React.CSSProperties,
  resultBox: (color: string) => ({
    background: color + "15",
    border: `1px solid ${color}40`,
    borderRadius: 8,
    padding: "12px 16px",
    fontSize: 14,
    color: "#111827",
    lineHeight: 1.6,
  } as React.CSSProperties),
};
