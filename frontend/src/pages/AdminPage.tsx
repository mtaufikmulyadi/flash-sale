/**
 * Admin page — /admin
 *
 * Shows current sale config and a form to create a new sale.
 * All times are in the user's local timezone for convenience.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAdminSale, createSale, type SaleState } from "../api";

// ── Helper: local datetime string for input default ──────────
function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toISO(localDatetime: string): string {
  return new Date(localDatetime).toISOString();
}

// ── Current sale card ─────────────────────────────────────────
function CurrentSaleCard({ sale }: { sale: SaleState }) {
  const statusColor: Record<string, string> = {
    upcoming: "#f59e0b",
    active:   "#22c55e",
    ended:    "#6b7280",
  };
  const color = statusColor[sale.status] ?? "#6b7280";

  return (
    <div style={s.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h3 style={s.cardTitle}>Current sale</h3>
        <span style={{ ...s.badge, background: color + "20", color }}>
          {sale.status}
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>
          {[
            ["Product",   sale.product_name],
            ["Stock",     `${sale.remaining_stock ?? "?"} / ${sale.total_stock} remaining`],
            ["Starts",    new Date(sale.start_time).toLocaleString()],
            ["Ends",      new Date(sale.end_time).toLocaleString()],
            ["Sale ID",   String(sale.id)],
          ].map(([label, value]) => (
            <tr key={label} style={{ borderBottom: "1px solid var(--color-border-tertiary, #f0f0f0)" }}>
              <td style={{ padding: "6px 0", color: "#6b7280", width: 90 }}>{label}</td>
              <td style={{ padding: "6px 0", fontWeight: 500, color: "#111827" }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Create sale form ──────────────────────────────────────────
function CreateSaleForm({ onCreated }: { onCreated: () => void }) {
  const now      = new Date();
  const startDef = new Date(now.getTime() + 60_000);
  const endDef   = new Date(now.getTime() + 31 * 60_000);

  const [productName, setProductName] = useState("Limited Edition Sneaker");
  const [stock,       setStock]       = useState("10");
  const [startTime,   setStartTime]   = useState(toLocalDatetimeInput(startDef));
  const [endTime,     setEndTime]     = useState(toLocalDatetimeInput(endDef));
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [success,     setSuccess]     = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    // Client-side validation
    if (!productName.trim())          return setError("Product name is required");
    if (isNaN(Number(stock)) || Number(stock) < 1)
                                       return setError("Stock must be a positive number");
    if (!startTime || !endTime)        return setError("Start and end time are required");
    if (new Date(endTime) <= new Date(startTime))
                                       return setError("End time must be after start time");

    setLoading(true);
    try {
      const result = await createSale({
        productName: productName.trim(),
        stock:       Number(stock),
        startTime:   toISO(startTime),
        endTime:     toISO(endTime),
      });
      setSuccess(`Sale #${result.saleId} created successfully`);
      onCreated();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Failed to create sale");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.card}>
      <h3 style={{ ...s.cardTitle, marginBottom: 16 }}>Create new sale</h3>
      <form onSubmit={handleSubmit}>

        <div style={s.field}>
          <label style={s.label}>Product name</label>
          <input
            style={s.input}
            value={productName}
            onChange={e => setProductName(e.target.value)}
            placeholder="e.g. Air Max 90"
            disabled={loading}
          />
        </div>

        <div style={s.field}>
          <label style={s.label}>Stock (number of items)</label>
          <input
            style={s.input}
            type="number"
            min={1}
            value={stock}
            onChange={e => setStock(e.target.value)}
            disabled={loading}
          />
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ ...s.field, flex: 1 }}>
            <label style={s.label}>Start time</label>
            <input
              style={s.input}
              type="datetime-local"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              disabled={loading}
            />
          </div>
          <div style={{ ...s.field, flex: 1 }}>
            <label style={s.label}>End time</label>
            <input
              style={s.input}
              type="datetime-local"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              disabled={loading}
            />
          </div>
        </div>

        {error && (
          <div style={{ ...s.alert, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ ...s.alert, background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0" }}>
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            ...s.btn,
            background: loading ? "#9ca3af" : "#3b82f6",
            marginTop: 4,
          }}
        >
          {loading ? "Creating..." : "Create sale"}
        </button>

        <p style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
          Creating a new sale will clear any existing sale and purchases.
        </p>
      </form>
    </div>
  );
}

// ── Admin page ────────────────────────────────────────────────
export default function AdminPage() {
  const queryClient = useQueryClient();
  const { data: sale, isLoading } = useQuery<SaleState | null>({
    queryKey:        ["adminSale"],
    queryFn:         fetchAdminSale,
    refetchInterval: 5_000,
    retry:           false,
  });

  function handleSaleCreated() {
    queryClient.invalidateQueries({ queryKey: ["adminSale"] });
    queryClient.invalidateQueries({ queryKey: ["sale"] });
  }

  return (
    <div style={{
      minHeight:       "100vh",
      background:      "#f9fafb",
      padding:         "32px 16px",
      fontFamily:      "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#111827", margin: 0 }}>
            Admin
          </h1>
          <a href="/" style={{ fontSize: 13, color: "#3b82f6", textDecoration: "none" }}>
            ← Back to sale
          </a>
        </div>

        {isLoading ? (
          <div style={s.card}>
            <p style={{ color: "#6b7280", fontSize: 14 }}>Loading...</p>
          </div>
        ) : sale ? (
          <CurrentSaleCard sale={sale} />
        ) : (
          <div style={s.card}>
            <p style={{ color: "#6b7280", fontSize: 14 }}>No sale configured yet.</p>
          </div>
        )}

        <CreateSaleForm onCreated={handleSaleCreated} />

      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────
const s = {
  card: {
    background:   "#fff",
    border:       "1px solid #e5e7eb",
    borderRadius: 12,
    padding:      "20px 24px",
    marginBottom: 16,
  } as React.CSSProperties,
  cardTitle: {
    fontSize:   16,
    fontWeight: 600,
    color:      "#111827",
    margin:     0,
  } as React.CSSProperties,
  badge: {
    fontSize:     12,
    fontWeight:   500,
    padding:      "3px 10px",
    borderRadius: 6,
  } as React.CSSProperties,
  field: {
    marginBottom: 14,
  } as React.CSSProperties,
  label: {
    display:      "block",
    fontSize:     13,
    fontWeight:   500,
    color:        "#374151",
    marginBottom: 5,
  } as React.CSSProperties,
  input: {
    width:        "100%",
    padding:      "8px 12px",
    border:       "1px solid #d1d5db",
    borderRadius: 8,
    fontSize:     14,
    outline:      "none",
    boxSizing:    "border-box",
  } as React.CSSProperties,
  alert: {
    padding:      "10px 14px",
    borderRadius: 8,
    fontSize:     13,
    marginBottom: 12,
  } as React.CSSProperties,
  btn: {
    width:        "100%",
    padding:      "10px",
    color:        "#fff",
    border:       "none",
    borderRadius: 8,
    fontSize:     14,
    fontWeight:   600,
    cursor:       "pointer",
  } as React.CSSProperties,
};
