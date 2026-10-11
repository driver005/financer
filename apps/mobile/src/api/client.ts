import type { components } from "./schema";

export type Transaction = components["schemas"]["TransactionDto"];
export type ImportReport = components["schemas"]["ImportReport"];
export type Recurring = components["schemas"]["RecurringDto"];
export type Envelope = components["schemas"]["EnvelopeDto"];
export type EnvelopeStatus = components["schemas"]["EnvelopeStatusDto"];
export type Disposable = components["schemas"]["DisposableDto"];
export type Price = components["schemas"]["PriceDto"];
export type RefreshReport = components["schemas"]["RefreshReportDto"];
export type Pick = components["schemas"]["PickDto"];
export type CatalogItem = components["schemas"]["CatalogItemDto"];
export type Basket = components["schemas"]["BasketDto"];
export type BasketItem = components["schemas"]["BasketItemDto"];
export type Receipt = components["schemas"]["ReceiptDto"];
export type Affordability = components["schemas"]["AffordabilityDto"];
export type RecipeMatch = components["schemas"]["RecipeMatchDto"];
export type Idea = components["schemas"]["IdeaDto"];
export type Settings = components["schemas"]["SettingsDto"];
export type SettingsUpdate = components["schemas"]["SettingsUpdate"];
export type Chain = "aldi" | "lidl" | "kaufland" | "rewe";

export type ApiConfig = { baseUrl: string; token: string };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Thin typed client for the Financer REST API (the same API the embedded backend will serve). */
export class Api {
  constructor(private config: ApiConfig) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.config.token}`, ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (typeof body?.error === "string") message = body.error;
      } catch {
        // body was not JSON; keep the status message
      }
      throw new ApiError(res.status, res.status === 401 ? "Wrong or missing API token" : message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private json<T>(path: string, method: string, body: unknown) {
    return this.request<T>(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** Open endpoint: checks the server is reachable, without needing the token. */
  async health(): Promise<boolean> {
    const base = this.config.baseUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/health`);
    return res.ok;
  }

  transactions() {
    return this.request<Transaction[]>("/v1/transactions");
  }

  importCsv(bytes: ArrayBuffer) {
    return this.request<ImportReport>("/v1/transactions/import", {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: bytes,
    });
  }

  recurring() {
    return this.request<Recurring[]>("/v1/recurring");
  }

  disposable() {
    return this.request<Disposable>("/v1/budget/disposable");
  }

  envelopes() {
    return this.request<Envelope[]>("/v1/budget/envelopes");
  }

  saveEnvelopes(envelopes: Envelope[]) {
    return this.request<Envelope[]>("/v1/budget/envelopes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelopes),
    });
  }

  budgetStatus(year: number, month: number) {
    return this.request<EnvelopeStatus[]>(`/v1/budget/status?year=${year}&month=${month}`);
  }

  prices(item?: string) {
    return this.request<Price[]>(`/v1/prices${item ? `?item=${encodeURIComponent(item)}` : ""}`);
  }

  refreshPrices() {
    return this.request<RefreshReport>("/v1/prices/refresh", { method: "POST" });
  }

  catalog() {
    return this.request<CatalogItem[]>("/v1/catalog");
  }

  basket() {
    return this.request<Basket>("/v1/basket");
  }

  saveBasket(items: BasketItem[]) {
    return this.json<Basket>("/v1/basket", "PUT", items);
  }

  receipts() {
    return this.request<Receipt[]>("/v1/receipts");
  }

  uploadReceipt(text: string) {
    return this.json<Receipt>("/v1/receipts", "POST", { text });
  }

  deleteReceipt(id: number) {
    return this.request<void>(`/v1/receipts/${id}`, { method: "DELETE" });
  }

  affordability(budgetCents?: number, daysPerBasket?: number) {
    const q = new URLSearchParams();
    if (budgetCents !== undefined) q.set("budget_cents", String(budgetCents));
    if (daysPerBasket !== undefined) q.set("days_per_basket", String(daysPerBasket));
    const qs = q.toString();
    return this.request<Affordability>(`/v1/affordability${qs ? `?${qs}` : ""}`);
  }

  recipes(opts: { budgetCents?: number; tag?: string; limit?: number } = {}) {
    const q = new URLSearchParams();
    if (opts.budgetCents !== undefined) q.set("budget_cents", String(opts.budgetCents));
    if (opts.tag) q.set("tag", opts.tag);
    if (opts.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return this.request<RecipeMatch[]>(`/v1/recipes${qs ? `?${qs}` : ""}`);
  }

  ideas(req: { count?: number; diet?: string; budget_cents?: number }) {
    return this.json<Idea[]>("/v1/recipes/ideas", "POST", req);
  }

  settings() {
    return this.request<Settings>("/v1/settings");
  }

  saveSettings(update: SettingsUpdate) {
    return this.json<Settings>("/v1/settings", "PUT", update);
  }
}
