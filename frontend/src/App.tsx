import { useQuery } from "@tanstack/react-query";
import { SaleStatus } from "./components/SaleStatus";
import { PurchaseForm } from "./components/PurchaseForm";
import { fetchSale, type SaleState } from "./api";
import AdminPage from "./pages/AdminPage";

// Simple client-side routing — no router library needed
function useRoute() {
  return window.location.pathname;
}

export default function App() {
  const route = useRoute();

  if (route === "/admin") return <AdminPage />;

  return <SalePage />;
}

function SalePage() {
  const { data: sale } = useQuery<SaleState>({
    queryKey:        ["sale"],
    queryFn:         fetchSale,
    refetchInterval: 5_000,
    retry:           false,
  });

  return (
    <div style={{
      minHeight:   "100vh",
      background:  "#f9fafb",
      display:     "flex",
      alignItems:  "center",
      justifyContent: "center",
      padding:     16,
      fontFamily:  "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#111827", margin: 0 }}>
            Flash Sale
          </h1>
          <a href="/admin" style={{ fontSize: 13, color: "#9ca3af", textDecoration: "none" }}>
            Admin →
          </a>
        </div>

        <SaleStatus />
        <PurchaseForm saleStatus={sale?.status} />

        <p style={{
          textAlign:  "center",
          fontSize:   12,
          color:      "#9ca3af",
          marginTop:  16,
        }}>
          One item per customer · Sale window enforced server-side
        </p>
      </div>
    </div>
  );
}
