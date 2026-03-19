/**
 * STEP 5 TESTS — React component tests (updated for two-step flow)
 *
 * SaleStatus tests (unchanged):
 *  - loading, active, upcoming, ended, error states
 *
 * PurchaseForm tests (updated + new):
 *  - login form, disabled continue, enable on input
 *  - shows payment screen after reservation (with countdown)
 *  - Pay Now button confirms purchase
 *  - Cancel button cancels reservation
 *  - shows confirmed result on pay
 *  - shows cancelled result on cancel
 *  - shows sold out on 410
 *  - shows already purchased on 409
 *  - shows expired when status comes back as expired
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SaleStatus } from "../components/SaleStatus";
import { PurchaseForm } from "../components/PurchaseForm";

vi.mock("../api", () => ({
  fetchSale:           vi.fn(),
  fetchToken:          vi.fn(),
  purchase:            vi.fn(),
  pay:                 vi.fn(),
  cancelPurchase:      vi.fn(),
  fetchPurchaseStatus: vi.fn(),
  setToken:            vi.fn(),
  getToken:            vi.fn(() => "mock-token"),
  clearToken:          vi.fn(),
  fetchAdminSale:      vi.fn(),
  createSale:          vi.fn(),
}));

import * as api from "../api";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const NOW = Date.now();
const activeSale = {
  id: 1, product_name: "Test Sneaker", total_stock: 10,
  remaining_stock: 7, status: "active" as const,
  start_time: new Date(NOW - 60_000).toISOString(),
  end_time:   new Date(NOW + 60_000).toISOString(),
};

const RESERVED_UNTIL = new Date(NOW + 10 * 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchPurchaseStatus).mockResolvedValue({ hasPurchased: false });
});

// ── SaleStatus ────────────────────────────────────────────────
describe("SaleStatus", () => {
  it("shows loading state initially", () => {
    vi.mocked(api.fetchSale).mockImplementation(() => new Promise(() => {}));
    render(<SaleStatus />, { wrapper });
    expect(screen.getByText(/loading sale info/i)).toBeInTheDocument();
  });

  it("shows product name when sale loads", async () => {
    vi.mocked(api.fetchSale).mockResolvedValue(activeSale);
    render(<SaleStatus />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText("Test Sneaker")).toBeInTheDocument()
    );
  });

  it("shows active badge and stock", async () => {
    vi.mocked(api.fetchSale).mockResolvedValue(activeSale);
    render(<SaleStatus />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/sale active/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/7 \/ 10/)).toBeInTheDocument();
  });

  it("shows upcoming badge for future sale", async () => {
    vi.mocked(api.fetchSale).mockResolvedValue({
      ...activeSale, status: "upcoming",
      start_time: new Date(NOW + 60_000).toISOString(),
    });
    render(<SaleStatus />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/sale starts in/i)).toBeInTheDocument()
    );
  });

  it("shows ended message", async () => {
    vi.mocked(api.fetchSale).mockResolvedValue({
      ...activeSale, status: "ended",
      end_time: new Date(NOW - 60_000).toISOString(),
    });
    render(<SaleStatus />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/sale has ended/i)).toBeInTheDocument()
    );
  });

  it("shows error when fetch fails", async () => {
    vi.mocked(api.fetchSale).mockRejectedValue(new Error("not found"));
    render(<SaleStatus />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/no sale found/i)).toBeInTheDocument()
    );
  });
});

// ── PurchaseForm — login step ─────────────────────────────────
describe("PurchaseForm — login", () => {
  it("shows login form initially", () => {
    render(<PurchaseForm saleStatus="active" />, { wrapper });
    expect(screen.getByPlaceholderText(/your@email.com/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });

  it("disables Continue when input is empty", () => {
    render(<PurchaseForm saleStatus="active" />, { wrapper });
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("enables Continue when userId is entered", () => {
    render(<PurchaseForm saleStatus="active" />, { wrapper });
    fireEvent.change(
      screen.getByPlaceholderText(/your@email.com/i),
      { target: { value: "alice@test.com" } }
    );
    expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled();
  });

  it("shows Buy Now after login", async () => {
    vi.mocked(api.fetchToken).mockResolvedValue("mock-jwt");
    render(<PurchaseForm saleStatus="active" />, { wrapper });
    fireEvent.change(
      screen.getByPlaceholderText(/your@email.com/i),
      { target: { value: "alice@test.com" } }
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /buy now/i })).toBeInTheDocument()
    );
  });

  it("disables Buy Now when sale not active", async () => {
    vi.mocked(api.fetchToken).mockResolvedValue("mock-jwt");
    render(<PurchaseForm saleStatus="upcoming" />, { wrapper });
    fireEvent.change(
      screen.getByPlaceholderText(/your@email.com/i),
      { target: { value: "alice@test.com" } }
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /sale not active/i })).toBeDisabled()
    );
  });
});

// ── PurchaseForm — payment step ───────────────────────────────
describe("PurchaseForm — payment screen", () => {
  async function goToPaymentScreen() {
    vi.mocked(api.fetchToken).mockResolvedValue("mock-jwt");
    vi.mocked(api.purchase).mockResolvedValue({
      purchaseId: 1, reservedUntil: RESERVED_UNTIL, message: "Item reserved",
    });
    render(<PurchaseForm saleStatus="active" />, { wrapper });
    fireEvent.change(
      screen.getByPlaceholderText(/your@email.com/i),
      { target: { value: "alice@test.com" } }
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => screen.getByRole("button", { name: /buy now/i }));
    fireEvent.click(screen.getByRole("button", { name: /buy now/i }));
    await waitFor(() => screen.getByRole("button", { name: /pay now/i }));
  }

  it("shows payment screen with countdown after reservation", async () => {
    await goToPaymentScreen();
    expect(screen.getByRole("button", { name: /pay now/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByText(/reservation/i)).toBeInTheDocument();
  });

  it("shows confirmed message after Pay Now", async () => {
    vi.mocked(api.pay).mockResolvedValue({
      status: "confirmed", message: "Payment confirmed. Reference: PAY-123-ABC",
    });
    await goToPaymentScreen();
    fireEvent.click(screen.getByRole("button", { name: /pay now/i }));
    await waitFor(() =>
      expect(screen.getByText(/payment confirmed/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/PAY-123-ABC/)).toBeInTheDocument();
  });

  it("shows cancelled message after Cancel", async () => {
    vi.mocked(api.cancelPurchase).mockResolvedValue({
      status: "cancelled", message: "Reservation cancelled",
    });
    await goToPaymentScreen();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() =>
      expect(screen.getByText(/reservation cancelled/i)).toBeInTheDocument()
    );
  });
});

// ── PurchaseForm — error states ───────────────────────────────
describe("PurchaseForm — error states", () => {
  async function loginAndBuy(purchaseError: object) {
    vi.mocked(api.fetchToken).mockResolvedValue("mock-jwt");
    vi.mocked(api.purchase).mockRejectedValue({ response: { data: purchaseError } });
    render(<PurchaseForm saleStatus="active" />, { wrapper });
    fireEvent.change(
      screen.getByPlaceholderText(/your@email.com/i),
      { target: { value: "alice@test.com" } }
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => screen.getByRole("button", { name: /buy now/i }));
    fireEvent.click(screen.getByRole("button", { name: /buy now/i }));
  }

  it("shows already purchased on 409", async () => {
    await loginAndBuy({ error: "ALREADY_PURCHASED" });
    await waitFor(() =>
      expect(screen.getByText(/already purchased/i)).toBeInTheDocument()
    );
  });

  it("shows sold out on 410", async () => {
    await loginAndBuy({ error: "SOLD_OUT" });
    await waitFor(() =>
      expect(screen.getByText(/sold out/i)).toBeInTheDocument()
    );
  });

  it("shows sale not active message", async () => {
    await loginAndBuy({ error: "SALE_NOT_ACTIVE", message: "Sale has ended" });
    await waitFor(() =>
      expect(screen.getByText(/sale not active/i)).toBeInTheDocument()
    );
  });
});
