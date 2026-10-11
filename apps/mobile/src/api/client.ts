import type { components } from "./schema";
import { RemoteTransport, type ApiConfig, type Transport } from "./transport";

export type { ApiConfig } from "./transport";

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
export type BankStatus = components["schemas"]["BankStatus"];
export type SyncStarted = components["schemas"]["SyncStarted"];
export type SyncDone = components["schemas"]["SyncDone"];
export type SyncRequest = components["schemas"]["SyncRequest"];
export type ScanResult = components["schemas"]["ScanDto"];
export type ExportData = components["schemas"]["ExportDto"];
export type ImportSummary = components["schemas"]["ImportReportDto"];
export type Subscriptions = components["schemas"]["SubscriptionsDto"];
export type Subscription = components["schemas"]["SubscriptionDto"];
export type UpcomingCharge = components["schemas"]["UpcomingChargeDto"];
export type PriceHike = components["schemas"]["PriceHikeDto"];
export type Alert = components["schemas"]["AlertDto"];
export type AlertList = components["schemas"]["AlertsDto"];
export type Chain = "aldi" | "lidl" | "kaufland" | "rewe";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Thin typed client for the Financer REST API (the same API the embedded backend serves). */
export class Api {
  private transport: Transport;

  /** `new Api(config)` talks to a server over HTTP; pass a [`Transport`] for the on-phone backend. */
  constructor(configOrTransport: ApiConfig | Transport) {
    this.transport = "send" in configOrTransport ? configOrTransport : new RemoteTransport(configOrTransport);
  }

  private async request<T>(path: string, init: { method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer } = {}): Promise<T> {
    const res = await this.transport.send({ method: init.method ?? "GET", path, headers: init.headers, body: init.body });
    if (res.status < 200 || res.status >= 300) {
      let message = `HTTP ${res.status}`;
      try {
        const body = JSON.parse(res.text);
        if (typeof body?.error === "string") message = body.error;
      } catch {
        // body was not JSON; keep the status message
      }
      throw new ApiError(res.status, res.status === 401 ? "Wrong or missing API token" : message);
    }
    if (res.status === 204 || res.text === "") return undefined as T;
    return JSON.parse(res.text) as T;
  }

  private json<T>(path: string, method: string, body: unknown) {
    return this.request<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  /** Open endpoint: checks the server is reachable, without needing the token. */
  async health(): Promise<boolean> {
    if (this.transport instanceof RemoteTransport) return this.transport.health();
    return true;
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

  /** Photo of a receipt: a vision model transcribes it and the server parses the transcript. */
  scanReceipt(imageBase64: string, mimeType: string) {
    return this.json<ScanResult>("/v1/receipts/scan", "POST", { image_base64: imageBase64, mime_type: mimeType });
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

  /** Calendar of expected charges for the next `days` days, price hikes, duplicates and stopped subscriptions. */
  subscriptions(days?: number) {
    return this.request<Subscriptions>(`/v1/subscriptions${days ? `?days=${days}` : ""}`);
  }

  /** Anomaly alerts; dismissed ones only with `includeDismissed`. */
  alerts(includeDismissed = false) {
    return this.request<AlertList>(`/v1/alerts${includeDismissed ? "?include_dismissed=true" : ""}`);
  }

  dismissAlert(id: string) {
    return this.request<{ id: string; dismissed: boolean }>(`/v1/alerts/${encodeURIComponent(id)}/dismiss`, { method: "POST" });
  }

  /** Everything that is yours as one document (no secrets, no prices). */
  exportData() {
    return this.request<ExportData>("/v1/export");
  }

  importData(data: ExportData) {
    return this.json<ImportSummary>("/v1/import", "POST", data);
  }

  bankStatus() {
    return this.request<BankStatus>("/v1/bank/status");
  }

  startSync(req: SyncRequest) {
    return this.json<SyncStarted>("/v1/bank/sync", "POST", req);
  }

  /** Throws `ApiError` with status 409 while the approval in the banking app is still missing. */
  confirmSync(id: string) {
    return this.request<SyncDone>(`/v1/bank/sync/${encodeURIComponent(id)}/confirm`, { method: "POST" });
  }
}
