/**
 * STEP 5 TESTS — React component tests
 *
 * Uses React Testing Library + Vitest.
 * Mocks the API module so components never make real HTTP calls.
 *
 * Tests:
 *  SaleStatus:
 *   - shows loading state
 *   - shows upcoming sale with countdown
 *   - shows active sale with stock bar
 *   - shows ended sale message
 *   - shows error when no sale found
 *
 *  PurchaseForm:
 *   - shows login form initially
 *   - disables continue button when input is empty
 *   - shows Buy Now after login
 *   - disables Buy Now when sale not active
 *   - shows success message on 201
 *   - shows already purchased on 409
 *   - shows sold out on 410
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SaleStatus } from "../components/SaleStatus";
import { PurchaseForm } from "../components/PurchaseForm";

// ── Mock the API module ───────────────────────────────────────
vi.mock("../api", () => ({
  fetchSale:            vi.fn(),
  fetchToken:           vi.fn(),
  purchase:             vi.fn(),
  fetchPurchaseStatus:  vi.fn(),
  setToken:             vi.fn(),
  getToken:             vi.fn(() => "mock-token"),
  clearToken:           vi.fn(),
}));

import * as api from "../api";

// ── Test helper ───────────────────────────────────────────────
function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const NOW = Date.now();
const activeSale = {
  id:              1,
  product_name:    "Test Sneaker",
  total_stock:     10,
  remaining_stock: 7,
  status:          "active" as const,
  start_time:      new Date(NOW - 60_000).toISOString(),
  end_time:        new Date(NOW + 60_000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default mock for fetchPurchaseStatus — user hasn't purchased
  vi.mocked(api.fetchPurchaseStatus).mockResolvedValue({ hasPurchased: false });
});

// ── SaleStatus tests ──────────────────────────────────────────
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

  it("shows active badge and stock for active sale", async () => {
    vi.mocked(api.fetchSale).mockResolvedValue(activeSale);
    render(<SaleStatus />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/sale active/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/7 \/ 10/)).toBeInTheDocument();
  });

  it("shows upcoming badge for future sale", async () => {
    vi.mocked(api.fetchSale).mockResolvedValue({
      ...activeSale,
      status:     "upcoming",
      start_time: new Date(NOW + 60_000).toISOString(),
    });
    render(<SaleStatus />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/sale starts in/i)).toBeInTheDocument()
    );
  });

  it("shows ended message for past sale", async () => {
    vi.mocked(api.fetchSale).mockResolvedValue({
      ...activeSale,
      status:   "ended",
      end_time: new Date(NOW - 60_000).toISOString(),
    });
    render(<SaleStatus />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/sale has ended/i)).toBeInTheDocument()
    );
  });

  it("shows error when sale fetch fails", async () => {
    vi.mocked(api.fetchSale).mockRejectedValue(new Error("not found"));
    render(<SaleStatus />, { wrapper });
    await waitFor(() =>
      expect(screen.getByText(/no sale found/i)).toBeInTheDocument()
    );
  });
});

// ── PurchaseForm tests ────────────────────────────────────────
describe("PurchaseForm", () => {
  it("shows login form initially", () => {
    render(<PurchaseForm saleStatus="active" />, { wrapper });
    expect(screen.getByPlaceholderText(/your@email.com/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeInTheDocument();
  });

  it("disables Continue button when input is empty", () => {
    render(<PurchaseForm saleStatus="active" />, { wrapper });
    const btn = screen.getByRole("button", { name: /continue/i });
    expect(btn).toBeDisabled();
  });

  it("enables Continue button when userId is entered", () => {
    render(<PurchaseForm saleStatus="active" />, { wrapper });
    fireEvent.change(
      screen.getByPlaceholderText(/your@email.com/i),
      { target: { value: "alice@test.com" } }
    );
    expect(screen.getByRole("button", { name: /continue/i })).not.toBeDisabled();
  });

  it("shows Buy Now button after successful login", async () => {
    vi.mocked(api.fetchToken).mockResolvedValue("mock-jwt-token");
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

  it("disables Buy Now when sale is not active", async () => {
    vi.mocked(api.fetchToken).mockResolvedValue("mock-jwt-token");
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

  it("shows success message after purchase", async () => {
    vi.mocked(api.fetchToken).mockResolvedValue("mock-jwt-token");
    vi.mocked(api.purchase).mockResolvedValue({ purchaseId: 42, message: "Purchase confirmed" });

    render(<PurchaseForm saleStatus="active" />, { wrapper });

    fireEvent.change(
      screen.getByPlaceholderText(/your@email.com/i),
      { target: { value: "alice@test.com" } }
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => screen.getByRole("button", { name: /buy now/i }));
    fireEvent.click(screen.getByRole("button", { name: /buy now/i }));

    await waitFor(() =>
      expect(screen.getByText(/purchase confirmed/i)).toBeInTheDocument()
    );
    expect(screen.getByText(/#42/)).toBeInTheDocument();
  });

  it("shows already purchased message on 409", async () => {
    vi.mocked(api.fetchToken).mockResolvedValue("mock-jwt-token");
    vi.mocked(api.purchase).mockRejectedValue({
      response: { data: { error: "ALREADY_PURCHASED" } },
    });

    render(<PurchaseForm saleStatus="active" />, { wrapper });
    fireEvent.change(
      screen.getByPlaceholderText(/your@email.com/i),
      { target: { value: "alice@test.com" } }
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => screen.getByRole("button", { name: /buy now/i }));
    fireEvent.click(screen.getByRole("button", { name: /buy now/i }));

    await waitFor(() =>
      expect(screen.getByText(/already purchased/i)).toBeInTheDocument()
    );
  });

  it("shows sold out message on 410", async () => {
    vi.mocked(api.fetchToken).mockResolvedValue("mock-jwt-token");
    vi.mocked(api.purchase).mockRejectedValue({
      response: { data: { error: "SOLD_OUT" } },
    });

    render(<PurchaseForm saleStatus="active" />, { wrapper });
    fireEvent.change(
      screen.getByPlaceholderText(/your@email.com/i),
      { target: { value: "alice@test.com" } }
    );
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => screen.getByRole("button", { name: /buy now/i }));
    fireEvent.click(screen.getByRole("button", { name: /buy now/i }));

    await waitFor(() =>
      expect(screen.getByText(/sold out/i)).toBeInTheDocument()
    );
  });
});
