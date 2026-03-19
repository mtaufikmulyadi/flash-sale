/**
 * PurchaseForm — two-step purchase flow
 *
 * Step 1: Enter userId → get JWT
 * Step 2: Click Buy Now → reserve slot (pending)
 * Step 3: Payment screen → Pay Now / Cancel (10-min countdown)
 * Step 4: Result (confirmed / cancelled / expired)
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchToken, purchase, pay, cancelPurchase,
  fetchPurchaseStatus, setToken, getToken,
  type PurchaseStatus,
} from "../api";

// ── Countdown to reservation expiry ──────────────────────────
function useReservationCountdown(reservedUntil: string | null) {
  const [timeLeft, setTimeLeft] = useState("");
  const [expired,  setExpired]  = useState(false);

  useEffect(() => {
    if (!reservedUntil) return;
    function update() {
      const diff = new Date(reservedUntil!).getTime() - Date.now();
      if (diff <= 0) { setTimeLeft("00:00"); setExpired(true); return; }
      const m = Math.floor(diff / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setTimeLeft(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    }
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [reservedUntil]);

  return { timeLeft, expired };
}

type FlowState =
  | { step: "login" }
  | { step: "buy" }
  | { step: "payment";   purchaseId: number; reservedUntil: string }
  | { step: "confirmed"; purchaseId: number; paymentRef: string }
  | { step: "cancelled" }
  | { step: "expired" }
  | { step: "already";   purchaseStatus: PurchaseStatus }
  | { step: "soldout" }
  | { step: "inactive";  message: string }
  | { step: "error";     message: string };

export function PurchaseForm({ saleStatus }: { saleStatus?: string }) {
  const [userId,     setUserId]     = useState("");
  const [flow,       setFlow]       = useState<FlowState>({ step: "login" });
  const [loading,    setLoading]    = useState(false);
  const [loginError, setLoginError] = useState("");

  const { data: purchaseStatus } = useQuery<PurchaseStatus>({
    queryKey:        ["purchaseStatus", userId],
    queryFn:         () => fetchPurchaseStatus(userId),
    enabled:         flow.step === "buy",
    refetchInterval: 5_000,
    retry:           false,
  });

  // If status check finds an existing purchase, show appropriate screen
  useEffect(() => {
    if (!purchaseStatus) return;
    if (purchaseStatus.hasPurchased) {
      if (purchaseStatus.status === "pending" && purchaseStatus.reservedUntil) {
        setFlow({ step: "payment", purchaseId: purchaseStatus.purchaseId!, reservedUntil: purchaseStatus.reservedUntil });
      } else if (purchaseStatus.status === "confirmed") {
        setFlow({ step: "already", purchaseStatus });
      } else if (purchaseStatus.status === "expired") {
        setFlow({ step: "expired" });
      }
    }
  }, [purchaseStatus]);

  // ── Step 1: Login ──────────────────────────────────────────
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim()) return;
    setLoading(true); setLoginError("");
    try {
      const token = await fetchToken(userId.trim());
      setToken(token);
      setFlow({ step: "buy" });
    } catch { setLoginError("Could not authenticate. Please try again."); }
    finally { setLoading(false); }
  }

  // ── Step 2: Reserve ────────────────────────────────────────
  async function handleBuy() {
    if (!getToken()) return;
    setLoading(true);
    try {
      const data = await purchase();
      setFlow({ step: "payment", purchaseId: data.purchaseId, reservedUntil: data.reservedUntil });
    } catch (err: any) {
      const code    = err?.response?.data?.error;
      const message = err?.response?.data?.message ?? "Something went wrong";
      if (code === "ALREADY_PURCHASED") setFlow({ step: "already", purchaseStatus: {} as PurchaseStatus });
      else if (code === "SOLD_OUT")     setFlow({ step: "soldout" });
      else if (code === "SALE_NOT_ACTIVE" || code === "SALE_NOT_FOUND") setFlow({ step: "inactive", message });
      else setFlow({ step: "error", message });
    } finally { setLoading(false); }
  }

  // ── Step 3a: Pay ───────────────────────────────────────────
  async function handlePay() {
    setLoading(true);
    try {
      const data = await pay();
      const ref  = data.message.match(/PAY-[A-Z0-9-]+/)?.[0] ?? "—";
      setFlow({ step: "confirmed", purchaseId: (flow as any).purchaseId, paymentRef: ref });
    } catch (err: any) {
      const code = err?.response?.data?.error;
      if (code === "RESERVATION_EXPIRED") setFlow({ step: "expired" });
      else setFlow({ step: "error", message: err?.response?.data?.message ?? "Payment failed" });
    } finally { setLoading(false); }
  }

  // ── Step 3b: Cancel ────────────────────────────────────────
  async function handleCancel() {
    setLoading(true);
    try {
      await cancelPurchase();
      setFlow({ step: "cancelled" });
    } catch { setFlow({ step: "error", message: "Cancellation failed. Please try again." }); }
    finally { setLoading(false); }
  }

  // ── Render ─────────────────────────────────────────────────
  if (flow.step === "login") return (
    <div style={s.card}>
      <h3 style={s.heading}>Enter your ID to participate</h3>
      <form onSubmit={handleLogin} style={{ display: "flex", gap: 8 }}>
        <input value={userId} onChange={e => setUserId(e.target.value)}
          placeholder="your@email.com" style={s.input} disabled={loading} />
        <button type="submit" style={s.btn("#3b82f6")} disabled={loading || !userId.trim()}>
          {loading ? "..." : "Continue"}
        </button>
      </form>
      {loginError && <p style={s.errorText}>{loginError}</p>}
    </div>
  );

  if (flow.step === "buy") {
    const isActive = saleStatus === "active";
    return (
      <div style={s.card}>
        <p style={{ fontSize: 14, color: "#6b7280", marginBottom: 12 }}>
          Logged in as <strong style={{ color: "#111827" }}>{userId}</strong>
        </p>
        <button onClick={handleBuy} disabled={loading || !isActive}
          style={s.btn(isActive ? "#3b82f6" : "#9ca3af")}>
          {loading ? "Reserving..." : isActive ? "Buy Now" : "Sale not active"}
        </button>
        {!isActive && <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>Button activates when sale opens.</p>}
      </div>
    );
  }

  if (flow.step === "payment") {
    return <PaymentScreen
      purchaseId={flow.purchaseId}
      reservedUntil={flow.reservedUntil}
      userId={userId}
      loading={loading}
      onPay={handlePay}
      onCancel={handleCancel}
      onExpired={() => setFlow({ step: "expired" })}
    />;
  }

  return (
    <div style={s.card}>
      {flow.step === "confirmed" && (
        <ResultBox color="#22c55e">
          <strong>Payment confirmed!</strong> Order #{flow.purchaseId}<br />
          <span style={{ fontSize: 12, opacity: 0.8 }}>Ref: {flow.paymentRef}</span>
        </ResultBox>
      )}
      {flow.step === "cancelled" && (
        <ResultBox color="#6b7280">
          <strong>Reservation cancelled.</strong> Your slot has been released.
        </ResultBox>
      )}
      {flow.step === "expired" && (
        <ResultBox color="#f59e0b">
          <strong>Reservation expired.</strong> The 10-minute window has passed and your slot was released.
        </ResultBox>
      )}
      {flow.step === "already" && (
        <ResultBox color="#3b82f6">
          <strong>Already purchased.</strong>{" "}
          {flow.purchaseStatus.paymentId ? `Ref: ${flow.purchaseStatus.paymentId}` : ""}
        </ResultBox>
      )}
      {flow.step === "soldout" && (
        <ResultBox color="#ef4444"><strong>Sold out.</strong> All items have been claimed.</ResultBox>
      )}
      {flow.step === "inactive" && (
        <ResultBox color="#f59e0b"><strong>Sale not active.</strong> {flow.message}</ResultBox>
      )}
      {flow.step === "error" && (
        <ResultBox color="#ef4444"><strong>Error.</strong> {flow.message}</ResultBox>
      )}
      <p style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>
        Logged in as <strong>{userId}</strong>
      </p>
    </div>
  );
}

// ── Payment screen ─────────────────────────────────────────────
function PaymentScreen({
  purchaseId, reservedUntil, userId,
  loading, onPay, onCancel, onExpired,
}: {
  purchaseId: number; reservedUntil: string; userId: string;
  loading: boolean;
  onPay: () => void; onCancel: () => void; onExpired: () => void;
}) {
  const { timeLeft, expired } = useReservationCountdown(reservedUntil);

  useEffect(() => { if (expired) onExpired(); }, [expired]);

  const urgentColor = timeLeft < "02:00" ? "#ef4444" : "#f59e0b";

  return (
    <div style={s.card}>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
          Reservation #{purchaseId} · Time remaining
        </div>
        <div style={{
          fontSize: 36, fontWeight: 800, color: urgentColor,
          fontVariantNumeric: "tabular-nums",
        }}>
          {timeLeft}
        </div>
        <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>
          Your item is reserved. Complete payment before the timer runs out.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onPay} disabled={loading || expired}
          style={{ ...s.btn("#22c55e"), flex: 2 }}>
          {loading ? "Processing..." : "Pay Now"}
        </button>
        <button onClick={onCancel} disabled={loading || expired}
          style={{ ...s.btn("#6b7280"), flex: 1 }}>
          Cancel
        </button>
      </div>

      <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8, textAlign: "center" }}>
        Logged in as <strong>{userId}</strong>
      </p>
    </div>
  );
}

function ResultBox({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: color + "15", border: `1px solid ${color}40`,
      borderRadius: 8, padding: "12px 16px", fontSize: 14,
      color: "#111827", lineHeight: 1.6,
    }}>
      {children}
    </div>
  );
}

const s = {
  card:    { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: "20px 24px" } as React.CSSProperties,
  heading: { fontSize: 16, fontWeight: 600, margin: "0 0 12px", color: "#111827" } as React.CSSProperties,
  input:   { flex: 1, padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 14, outline: "none" } as React.CSSProperties,
  btn:     (bg: string) => ({ background: bg, color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", width: "100%" } as React.CSSProperties),
  errorText: { color: "#ef4444", fontSize: 13, marginTop: 8 } as React.CSSProperties,
};
