/**
 * SaleStatus
 *
 * Displays the current sale state:
 *  - upcoming → countdown to start
 *  - active   → stock bar + time remaining
 *  - ended    → sale over message
 *  - loading/error states
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSale, type SaleState } from "../api";

// ── Countdown helper ─────────────────────────────────────────
function useCountdown(targetIso: string) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    function update() {
      const diff = new Date(targetIso).getTime() - Date.now();
      if (diff <= 0) { setRemaining("00:00:00"); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setRemaining(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      );
    }
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [targetIso]);

  return remaining;
}

// ── Stock bar ────────────────────────────────────────────────
function StockBar({ remaining, total }: { remaining: number; total: number }) {
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  const color = pct > 50 ? "#22c55e" : pct > 20 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
        <span style={{ color: "#6b7280" }}>Stock remaining</span>
        <span style={{ fontWeight: 600 }}>{remaining} / {total}</span>
      </div>
      <div style={{ background: "#e5e7eb", borderRadius: 99, height: 8, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.5s" }} />
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────
export function SaleStatus() {
  const { data: sale, isLoading, isError } = useQuery<SaleState>({
    queryKey:  ["sale"],
    queryFn:   fetchSale,
    refetchInterval: 5_000, // poll every 5s
    retry: false,
  });

  const countdown = useCountdown(
    sale?.status === "upcoming" ? sale.start_time :
    sale?.status === "active"   ? sale.end_time   : ""
  );

  if (isLoading) return (
    <div style={styles.card}>
      <p style={{ color: "#6b7280" }}>Loading sale info...</p>
    </div>
  );

  if (isError || !sale) return (
    <div style={styles.card}>
      <p style={{ color: "#ef4444" }}>No sale found.</p>
    </div>
  );

  return (
    <div style={styles.card}>
      <h2 style={styles.productName}>{sale.product_name}</h2>

      {sale.status === "upcoming" && (
        <div style={styles.statusBadge("#f59e0b")}>
          Sale starts in <strong>{countdown}</strong>
        </div>
      )}

      {sale.status === "active" && (
        <>
          <div style={styles.statusBadge("#22c55e")}>
            Sale active — ends in <strong>{countdown}</strong>
          </div>
          {sale.remaining_stock !== null && (
            <StockBar remaining={sale.remaining_stock} total={sale.total_stock} />
          )}
        </>
      )}

      {sale.status === "ended" && (
        <div style={styles.statusBadge("#6b7280")}>
          Sale has ended
        </div>
      )}
    </div>
  );
}

const styles = {
  card: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 16,
  } as React.CSSProperties,
  productName: {
    fontSize: 20,
    fontWeight: 700,
    margin: "0 0 12px",
    color: "#111827",
  } as React.CSSProperties,
  statusBadge: (color: string) => ({
    display: "inline-block",
    background: color + "20",
    color,
    borderRadius: 6,
    padding: "4px 12px",
    fontSize: 14,
    fontWeight: 500,
  } as React.CSSProperties),
};
