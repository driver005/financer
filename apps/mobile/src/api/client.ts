import type { components } from "./schema";
import { RemoteTransport, type ApiConfig, type Transport } from "./transport";

export type { ApiConfig } from "./transport";

export type Transaction = components["schemas"]["TransactionDto"];
export type ImportReport = components["schemas"]["ImportReport"];
export type Recurring = components["schemas"]["RecurringDto"];
export type Envelope = components["schemas"]["EnvelopeDto"];
export type EnvelopeStatus = components["schemas"]["EnvelopeStatusDto"];
export type Disposable = components["schemas"]["DisposableDto"];
export type BudgetPeriod = components["schemas"]["PeriodDto"];
export type SafeToSpend = components["schemas"]["SafeToSpendDto"];
export type Forecast = components["schemas"]["ForecastDto"];
export type Price = components["schemas"]["PriceDto"];
export type EanLookup = components["schemas"]["EanLookupDto"];
export type ChainPrice = components["schemas"]["ChainPriceDto"];
export type Observation = components["schemas"]["ObservationDto"];
export type RefreshReport = components["schemas"]["RefreshReportDto"];
export type Pick = components["schemas"]["PickDto"];
export type CatalogItem = components["schemas"]["CatalogItemDto"];
export type Basket = components["schemas"]["BasketDto"];
export type BasketItem = components["schemas"]["BasketItemDto"];
export type Receipt = components["schemas"]["ReceiptDto"];
export type Affordability = components["schemas"]["AffordabilityDto"];
export type RecipeMatch = components["schemas"]["RecipeMatchDto"];
export type Idea = components["schemas"]["IdeaDto"];
export type MealPlan = components["schemas"]["MealPlanDto"];
export type MealDay = components["schemas"]["MealDayDto"];
export type MealDayInput = components["schemas"]["MealDayInput"];
export type MealShoppingList = components["schemas"]["ShoppingListDto"];
export type ShoppingItem = components["schemas"]["ShoppingItemDto"];
export type Pantry = components["schemas"]["PantryDto"];
export type Settings = components["schemas"]["SettingsDto"];
export type SettingsUpdate = components["schemas"]["SettingsUpdate"];
export type BankStatus = components["schemas"]["BankStatus"];
export type SyncStarted = components["schemas"]["SyncStarted"];
export type SyncDone = components["schemas"]["SyncDone"];
export type SyncRequest = components["schemas"]["SyncRequest"];
export type BankConnection = components["schemas"]["BankConnectionDto"];
export type ConnectionState = components["schemas"]["ConnectionState"];
export type StoreSpend = components["schemas"]["StoreSpendDto"];
export type StoreSpending = components["schemas"]["StoresDto"];
export type StoresPeriod = components["schemas"]["StoresPeriod"];
export type ScanResult =components["schemas"]["ScanDto"];
export type ExportData = components["schemas"]["ExportDto"];
export type ImportSummary = components["schemas"]["ImportReportDto"];
export type Rule = components["schemas"]["RuleDto"];
export type RuleInput = components["schemas"]["RuleInput"];
export type CategoryChanged = components["schemas"]["CategoryChanged"];
export type Split = components["schemas"]["SplitDto"];
export type SplitInput = components["schemas"]["SplitInput"];
export type Suggestions = components["schemas"]["SuggestionsDto"];
export type AcceptReport = components["schemas"]["AcceptReport"];
export type Subscriptions = components["schemas"]["SubscriptionsDto"];
export type Subscription = components["schemas"]["SubscriptionDto"];
export type UpcomingCharge = components["schemas"]["UpcomingChargeDto"];
export type PriceHike = components["schemas"]["PriceHikeDto"];
export type Alert = components["schemas"]["AlertDto"];
export type AlertList = components["schemas"]["AlertsDto"];
export type EncryptedBackup = components["schemas"]["BackupDto"];
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

  /** The budget status of the current or the previous budget period (see `budgetPeriod`). */
  budgetStatusFor(period: "current" | "previous", date?: string) {
    const q = new URLSearchParams({ period });
    if (date) q.set("date", date);
    return this.request<EnvelopeStatus[]>(`/v1/budget/status?${q}`);
  }

  /** The budget period (payday to payday). `date` is the local day, so a late evening is not tomorrow. */
  budgetPeriod(period: "current" | "previous" = "current", date?: string) {
    const q = new URLSearchParams({ period });
    if (date) q.set("date", date);
    return this.request<BudgetPeriod>(`/v1/budget/period?${q}`);
  }

  safeToSpend(date?: string) {
    return this.request<SafeToSpend>(`/v1/budget/safe-to-spend${date ? `?date=${date}` : ""}`);
  }

  /** Where the current budget period is heading; `date` is the local day. */
  forecast(date?: string) {
    return this.request<Forecast>(`/v1/forecast${date ? `?date=${date}` : ""}`);
  }

  prices(item?: string) {
    return this.request<Price[]>(`/v1/prices${item ? `?item=${encodeURIComponent(item)}` : ""}`);
  }

  /** What a scanned barcode (EAN-8, EAN-13, UPC-A) costs per chain. 400 for an invalid barcode. */
  eanLookup(ean: string) {
    return this.request<EanLookup>(`/v1/prices/ean/${encodeURIComponent(ean)}`);
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

  /** The meals planned for the week that contains `week` (Monday to Sunday). */
  mealPlan(week: string) {
    return this.request<MealPlan>(`/v1/meal-plan?week=${encodeURIComponent(week)}`);
  }

  /** Replaces the plan of the week; days that are not listed become empty. */
  saveMealPlan(week: string, days: MealDayInput[]) {
    return this.json<MealPlan>(`/v1/meal-plan?week=${encodeURIComponent(week)}`, "PUT", { days });
  }

  /** Ingredients of the week's meals, priced per chain and checked against the groceries budget. `date` is the local day. */
  mealShoppingList(week: string, date?: string) {
    const q = new URLSearchParams({ week });
    if (date) q.set("date", date);
    return this.request<MealShoppingList>(`/v1/meal-plan/shopping-list?${q}`);
  }

  pantry() {
    return this.request<Pantry>("/v1/meal-plan/pantry");
  }

  /** Replaces the list of items assumed to be at home (catalog keys). */
  savePantry(items: string[]) {
    return this.json<Pantry>("/v1/meal-plan/pantry", "PUT", { items });
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

  /** The same data as `exportData`, encrypted with a passphrase (an `age` file, base64). */
  createBackup(passphrase: string) {
    return this.json<EncryptedBackup>("/v1/backup/create", "POST", { passphrase });
  }

  /** Merge an encrypted backup; a wrong passphrase or damaged file is a 400 and changes nothing. */
  restoreBackup(passphrase: string, dataBase64: string) {
    return this.json<ImportSummary>("/v1/backup/restore", "POST", { passphrase, data_base64: dataBase64 });
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

  /** The bank connections of the server's financer.toml, without secrets. Empty when none is configured. */
  bankConnections() {
    return this.request<BankConnection[]>("/v1/bank/connections");
  }

  /**
   * Log in for one connection; the server then waits for the approval in the banking app and imports by
   * itself. Send `pin` only when the connection has no `pin_from_env`.
   */
  syncConnection(name: string, pin?: string) {
    const path = `/v1/bank/connections/${encodeURIComponent(name)}/sync`;
    return pin ? this.json<BankConnection>(path, "POST", { pin }) : this.request<BankConnection>(path, { method: "POST" });
  }

  /** Stop waiting for an approval. */
  cancelConnection(name: string) {
    return this.request<BankConnection>(`/v1/bank/connections/${encodeURIComponent(name)}/cancel`, { method: "POST" });
  }

  /** Spending per supermarket chain for the current/previous budget period or the last `n` periods. `date` is the local day. */
  storeSpending(period: StoresPeriod = "current", opts: { n?: number; date?: string } = {}) {
    return this.request<StoreSpending>(`/v1/spending/stores?${Api.storeQuery(period, opts)}`);
  }

  /** The bookings behind one chain's total (`other` = groceries no chain matched), newest first. */
  storeTransactions(chain: string, period: StoresPeriod = "current", opts: { n?: number; date?: string } = {}) {
    return this.request<Transaction[]>(
      `/v1/spending/stores/${encodeURIComponent(chain)}/transactions?${Api.storeQuery(period, opts)}`,
    );
  }

  private static storeQuery(period: StoresPeriod, opts: { n?: number; date?: string }) {
    const q = new URLSearchParams({ period });
    if (period === "last_n" && opts.n) q.set("n", String(opts.n));
    if (opts.date) q.set("date", opts.date);
    return q;
  }

  // ---- categorization: rules, corrections, splits, AI suggestions ----

  rules() {
    return this.request<Rule[]>("/v1/rules");
  }

  createRule(rule: RuleInput) {
    return this.json<Rule>("/v1/rules", "POST", rule);
  }

  updateRule(id: number, rule: RuleInput) {
    return this.json<Rule>(`/v1/rules/${id}`, "PUT", rule);
  }

  deleteRule(id: number) {
    return this.request<void>(`/v1/rules/${id}`, { method: "DELETE" });
  }

  /** `ids` lists every rule once, highest priority first. */
  reorderRules(ids: number[]) {
    return this.json<Rule[]>("/v1/rules/reorder", "POST", { ids });
  }

  /** Re-run the rules over existing transactions; resolves with how many changed. */
  applyRules() {
    return this.request<{ changed: number }>("/v1/rules/apply", { method: "POST" });
  }

  /** `remember` also makes a rule for the merchant and applies it to its other transactions. */
  setCategory(id: number, category: string, remember: boolean) {
    return this.json<CategoryChanged>(`/v1/transactions/${id}/category`, "PUT", { category, remember });
  }

  splits() {
    return this.request<Split[]>("/v1/transactions/splits");
  }

  putSplit(id: number, split: SplitInput) {
    return this.json<Split>(`/v1/transactions/${id}/split`, "PUT", split);
  }

  deleteSplit(id: number) {
    return this.request<void>(`/v1/transactions/${id}/split`, { method: "DELETE" });
  }

  /** Asks the configured AI for categories of merchants nothing placed; sends merchant names only. */
  suggestCategories() {
    return this.request<Suggestions>("/v1/transactions/categorize-unknown", { method: "POST" });
  }

  acceptSuggestions(suggestions: { merchant: string; category: string }[]) {
    return this.json<AcceptReport>("/v1/transactions/categorize-unknown/accept", "POST", { suggestions });
  }
}
