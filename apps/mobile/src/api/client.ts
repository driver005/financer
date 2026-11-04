import type { components } from "./schema";
import { RemoteTransport, type ApiConfig, type Transport } from "./transport";

export type { ApiConfig } from "./transport";

export type Transaction = components["schemas"]["TransactionDto"];
export type ImportReport = components["schemas"]["FileImportDto"];
export type Recurring = components["schemas"]["RecurringDto"];
export type Envelope = components["schemas"]["EnvelopeInput"];
export type EnvelopeStatus = components["schemas"]["EnvelopeStatusDto"];
export type Disposable = components["schemas"]["DisposableDto"];
/** The budget in one answer: the period, its envelopes with what was spent, the daily number, the monthly picture. */
export type Budget = components["schemas"]["BudgetDto"];
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
export type ReceiptSource = components["schemas"]["ReceiptSourceDto"];
export type ReceiptSync = components["schemas"]["ReceiptSyncDto"];
/** Starting a sign-in on a shop's own page (`sign_in` sources). */
export type SourceConnect = components["schemas"]["SourceConnectDto"];
/** A receipt (or an order) a `push` source hands over. */
export type ReceiptInput = components["schemas"]["ReceiptInput"];
export type ReceiptImport = components["schemas"]["ReceiptImportDto"];
/** The sources a receipt can come from, and the key every call of one source is made with. */
export type SourceKind = "email" | "lidl_plus" | "kaufland_card" | "folder" | "rewe_app" | "orders_file";
export type Affordability = components["schemas"]["AffordabilityDto"];
export type RecipeMatch = components["schemas"]["RecipeMatchDto"];
export type Idea = components["schemas"]["IdeaDto"];
export type MealPlan = components["schemas"]["MealPlanDto"];
export type MealDay = components["schemas"]["MealDayDto"];
export type MealDayInput = components["schemas"]["MealDayInput"];
export type MealShoppingList = components["schemas"]["ShoppingListDto"];
export type ShoppingItem = components["schemas"]["ShoppingItemDto"];
export type Pantry = components["schemas"]["PantryDto"];
export type Calendar = components["schemas"]["CalendarDto"];
export type CalendarInput = components["schemas"]["CalendarInput"];
export type CalendarEvent = components["schemas"]["EventDto"];
export type CalendarEventInput = components["schemas"]["EventInput"];
export type Repeat = components["schemas"]["RepeatDto"];
export type Settings = components["schemas"]["SettingsDto"];
export type SettingsUpdate = components["schemas"]["SettingsInput"];
export type BankStatus = components["schemas"]["BankStatusDto"];
export type SyncRequest = components["schemas"]["SyncInput"];
/** A sync, whichever provider: what the person has to do next, or how it ended. */
export type Sync = components["schemas"]["SyncDto"];
/** A way transactions come in (csv, fints, plaid, gocardless, finapi) and whether the server has it. */
export type ProviderInfo = components["schemas"]["ProviderDto"];
export type BankConnection = components["schemas"]["BankConnectionDto"];
export type ConnectionState = components["schemas"]["ConnectionState"];
export type StoreSpend = components["schemas"]["StoreSpendDto"];
export type StoreSpending = components["schemas"]["StoresDto"];
export type StoresPeriod = components["schemas"]["StoresPeriod"];
export type ScanResult =components["schemas"]["ScanDto"];
export type ExportData = components["schemas"]["DataDto"];
export type ImportSummary = components["schemas"]["ImportReportDto"];
export type Rule = components["schemas"]["RuleDto"];
export type RuleInput = components["schemas"]["RuleInput"];
export type CategoryChanged = components["schemas"]["CategoryChangedDto"];
export type Split = components["schemas"]["SplitDto"];
export type SplitInput = components["schemas"]["SplitInput"];
export type Suggestions = components["schemas"]["SuggestionsDto"];
export type AcceptReport = components["schemas"]["CategoriesChangedDto"];
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
    /** One entry per problem when the server refused a change (saving the server settings). */
    public problems: string[] = [],
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
      let problems: string[] = [];
      try {
        const body = JSON.parse(res.text);
        if (typeof body?.error === "string") message = body.error;
        if (Array.isArray(body?.problems)) problems = body.problems.filter((p: unknown) => typeof p === "string");
      } catch {
        // body was not JSON; keep the status message
      }
      throw new ApiError(res.status, res.status === 401 ? "Wrong or missing API token" : message, problems);
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

  /** Hand a file to a provider with the `file` flow (`csv`: the Sparkasse CSV-CAMT export). */
  importFile(kind: "csv", bytes: ArrayBuffer) {
    return this.request<ImportReport>(`/v1/bank/import/${encodeURIComponent(kind)}`, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      body: bytes,
    });
  }

  recurring() {
    return this.request<Recurring[]>("/v1/recurring");
  }

  /**
   * The budget in one call: the period (payday to payday), every envelope with its limit and what was spent,
   * the daily number (`safe_to_spend`, only for the current period) and the monthly picture (`disposable`).
   * `date` is the local day, so a late evening is not tomorrow.
   */
  budget(period: "current" | "previous" = "current", date?: string) {
    const q = new URLSearchParams({ period });
    if (date) q.set("date", date);
    return this.request<Budget>(`/v1/budget?${q}`);
  }

  /** Replace all envelope limits; answers with the envelopes of the current period. */
  saveEnvelopes(envelopes: Envelope[]) {
    return this.request<EnvelopeStatus[]>("/v1/budget/envelopes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelopes),
    });
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
    return this.request<RefreshReport>("/v1/prices/refreshes", { method: "POST" });
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
    return this.json<ScanResult>("/v1/receipts/scans", "POST", { image_base64: imageBase64, mime_type: mimeType });
  }

  deleteReceipt(id: number) {
    return this.request<void>(`/v1/receipts/${id}`, { method: "DELETE" });
  }

  /** Every receipt source (mailbox, folder, Lidl Plus, Kaufland Card, REWE, orders file), its `flow` and how it is doing. */
  receiptSources() {
    return this.request<ReceiptSource[]>("/v1/receipts/sources");
  }

  /** One source. */
  receiptSource(kind: SourceKind) {
    return this.request<ReceiptSource>(`/v1/receipts/sources/${kind}`);
  }

  /** Run the enabled sources now, or just one. */
  syncReceipts(source?: string) {
    return source ? this.json<ReceiptSync>("/v1/receipts/sync", "POST", { source }) : this.request<ReceiptSync>("/v1/receipts/sync", { method: "POST" });
  }

  /** `sign_in` sources: begin the sign-in; the returned address is the shop's own page. */
  connectSource(kind: SourceKind) {
    return this.request<SourceConnect>(`/v1/receipts/sources/${kind}/connect`, { method: "POST" });
  }

  /** `sign_in` sources: finish the sign-in with the address the page redirected to. */
  finishSource(kind: SourceKind, state: string, callbackUrl: string) {
    return this.json<ReceiptSource>(`/v1/receipts/sources/${kind}/finish`, "POST", { state, callback_url: callbackUrl });
  }

  /** Forget the connection (a stored token, or the note of the last push). Receipts already stored stay. */
  disconnectSource(kind: SourceKind) {
    return this.request<ReceiptSource>(`/v1/receipts/sources/${kind}/disconnect`, { method: "POST" });
  }

  /** `push` sources: which of the shop's receipt ids (read in the app's browser window) are not stored yet. */
  knownReceipts(kind: SourceKind, ids: string[]) {
    return this.json<components["schemas"]["ReceiptKnownDto"]>(`/v1/receipts/sources/${kind}/known`, "POST", { ids });
  }

  /** `push` sources: store the receipts the app read (REWE's web shop) or the orders it read from a file (`shop` names the web shop, for `orders_file`). */
  importReceipts(kind: SourceKind, receipts: ReceiptInput[], shop?: string) {
    return this.json<ReceiptImport>(`/v1/receipts/sources/${kind}/import`, "POST", shop === undefined ? { receipts } : { shop, receipts });
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
    return this.request<MealShoppingList>(`/v1/shopping-list?${q}`);
  }

  pantry() {
    return this.request<Pantry>("/v1/pantry");
  }

  /** Replaces the list of items assumed to be at home (catalog keys). */
  savePantry(items: string[]) {
    return this.json<Pantry>("/v1/pantry", "PUT", { items });
  }

  settings() {
    return this.request<Settings>("/v1/settings");
  }

  /**
   * Every key of the server's financer.toml with its value and where it comes from. Answers 404 on
   * the on-phone backend, which has no such file.
   */
  serverConfig() {
    return this.request<components["schemas"]["ConfigDto"]>("/v1/server-config");
  }

  /**
   * Save changes to the server's configuration. The server checks them first (HTTP 422 with
   * `problems` when it refuses; 409 when an environment variable decides a key), then restarts to
   * apply them.
   */
  saveServerConfig(change: components["schemas"]["ConfigChangeInput"]) {
    return this.json<components["schemas"]["ConfigSavedDto"]>("/v1/server-config", "PUT", change);
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
    return this.request<ExportData>("/v1/data");
  }

  importData(data: ExportData) {
    return this.json<ImportSummary>("/v1/data", "POST", data);
  }

  /** The same data as `exportData`, encrypted with a passphrase (an `age` file, base64). */
  createBackup(passphrase: string) {
    return this.json<EncryptedBackup>("/v1/backups", "POST", { passphrase });
  }

  /** Merge an encrypted backup; a wrong passphrase or damaged file is a 400 and changes nothing. */
  restoreBackup(passphrase: string, dataBase64: string) {
    return this.json<ImportSummary>("/v1/backups/restorations", "POST", { passphrase, data_base64: dataBase64 });
  }

  /** What the last login sent with a request looked like (non-secret), to prefill a form. */
  bankStatus() {
    return this.request<BankStatus>("/v1/bank/status");
  }

  /** Every way transactions come in, how each works (`file`, `approval`, `link`) and whether this server has it. */
  providers() {
    return this.request<ProviderInfo[]>("/v1/bank/providers");
  }

  /** The bank connections of the server's financer.toml, without secrets. Empty when none is configured. */
  bankConnections() {
    return this.request<BankConnection[]>("/v1/bank/connections");
  }

  /**
   * Start a sync, whichever provider: name a `connection` of the server's configuration, or for FinTS a
   * `kind` with a `login`. The server then waits for the approval in the banking app (`needs_approval`) or
   * for the sign-in on the provider's page (`needs_link`, with `link_url`) and imports by itself. Send
   * `pin` only when the connection has no `pin_from_env`.
   */
  startSync(req: SyncRequest) {
    return this.json<Sync>("/v1/bank/sync", "POST", req);
  }

  /** Where a sync stands. Ask while its `state` is `syncing`, `needs_approval` or `needs_link`. */
  syncStatus(id: string) {
    return this.request<Sync>(`/v1/bank/sync/${encodeURIComponent(id)}`);
  }

  /** Stop waiting for an approval or a sign-in. */
  cancelSync(id: string) {
    return this.request<Sync>(`/v1/bank/sync/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  }

  /** Plaid, GoCardless, finAPI: forget the connection (the server tells the provider and deletes its access). Imported transactions stay. */
  disconnectConnection(name: string) {
    return this.request<BankConnection>(`/v1/bank/connections/${encodeURIComponent(name)}/disconnect`, { method: "POST" });
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

  /**
   * Where the shopping assistant's current subscription plans end (a phone or internet contract).
   * The assistant runs under `/v1/shop` on the same server when the build has it; without it, or
   * without a plan, the answer is an empty list.
   */
  async shopContracts(): Promise<{ category: string; name: string; plan: string | null; endsOn: string }[]> {
    try {
      const categories = await this.request<{ id: string; name: string; kind: string }[]>("/v1/shop/categories");
      const out: { category: string; name: string; plan: string | null; endsOn: string }[] = [];
      for (const c of categories.filter((x) => x.kind === "subscription")) {
        const plan = await this.request<{ name?: string | null; ends_on?: string | null } | null>(`/v1/shop/my/${encodeURIComponent(c.id)}`);
        if (plan?.ends_on) out.push({ category: c.id, name: c.name, plan: plan.name ?? null, endsOn: plan.ends_on });
      }
      return out;
    } catch {
      return [];
    }
  }

  // ---- calendar ----

  calendars() {
    return this.request<Calendar[]>("/v1/calendar/calendars");
  }

  createCalendar(calendar: CalendarInput) {
    return this.json<Calendar>("/v1/calendar/calendars", "POST", calendar);
  }

  updateCalendar(id: number, calendar: CalendarInput) {
    return this.json<Calendar>(`/v1/calendar/calendars/${id}`, "PUT", calendar);
  }

  deleteCalendar(id: number) {
    return this.request<void>(`/v1/calendar/calendars/${id}`, { method: "DELETE" });
  }

  /** Events that can show between two days (`YYYY-MM-DD`, inclusive); repeating ones come as one rule. */
  calendarEvents(from: string, to: string) {
    return this.request<CalendarEvent[]>(`/v1/calendar/events?from=${from}&to=${to}`);
  }

  createEvent(event: CalendarEventInput) {
    return this.json<CalendarEvent>("/v1/calendar/events", "POST", event);
  }

  updateEvent(id: number, event: CalendarEventInput) {
    return this.json<CalendarEvent>(`/v1/calendar/events/${id}`, "PUT", event);
  }

  deleteEvent(id: number) {
    return this.request<void>(`/v1/calendar/events/${id}`, { method: "DELETE" });
  }

  /** Delete one occurrence of a repeating event. */
  skipOccurrence(id: number, date: string) {
    return this.json<CalendarEvent>(`/v1/calendar/events/${id}/exceptions`, "POST", { date });
  }

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
    return this.json<Rule[]>("/v1/rules/order", "PUT", { ids });
  }

  /** Re-run the rules over existing transactions; resolves with how many changed. */
  applyRules() {
    return this.request<{ changed: number }>("/v1/rules/applications", { method: "POST" });
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
    return this.request<Suggestions>("/v1/transactions/suggestions", { method: "POST" });
  }

  acceptSuggestions(suggestions: { merchant: string; category: string }[]) {
    return this.json<AcceptReport>("/v1/transactions/categories", "PUT", { suggestions });
  }
}
