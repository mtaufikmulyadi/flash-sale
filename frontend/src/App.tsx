import { useQuery } from "@tanstack/react-query";
import { SaleStatus } from "./components/SaleStatus";
import { PurchaseForm } from "./components/PurchaseForm";
import { fetchSale, type SaleState } from "./api";

export default function App() {
  const { data: sale } = useQuery<SaleState>({
    queryKey: ["sale"],
    queryFn:  fetchSale,
    refetchInterval: 5_000,
    retry: false,
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "#f9fafb",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <h1 style={{
          fontSize: 28,
          fontWeight: 800,
          textAlign: "center",
          margin: "0 0 24px",
          color: "#111827",
        }}>
          Flash Sale
        </h1>

        <SaleStatus />
        <PurchaseForm saleStatus={sale?.status} />

        <p style={{
          textAlign: "center",
          fontSize: 12,
          color: "#9ca3af",
          marginTop: 16,
        }}>
          One item per customer · Sale window enforced server-side
        </p>
      </div>
    </div>
  );
}
