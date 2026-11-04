import type { components } from "./schema";
import { CallError, type Caller } from "../../../../packages/wire/src";

/** Where a server is and the token it accepts. */
export type ApiConfig = { baseUrl: string; token: string };

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
export type BasketItem = components["schemas"]["BasketItemInput"];
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
/** A sync, whichever provider: what the person has to do next, or how it ended. */
export type Sync = components["schemas"]["SyncDto"];
/** A way transactions come in (csv, fints, plaid, gocardless, finapi) and whether the server has it. */
export type ProviderInfo = components["schemas"]["ProviderDto"];
export type SyncRequest = components["schemas"]["SyncInput"];
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

export class ApiError extends CallError {
  constructor(status: number, message: string, problems: string[] = []) {
    super(status, status === 401 ? "Wrong or missing API token" : message, problems);
  }
}

type Page = { period: StoresPeriod; n?: number; date?: string };

/**
 * The Financer API as the screens use it. Every method names a call of the Rust SDK (the operation id
 * of the server's OpenAPI document) and passes its values by name; the paths, the encoding and the
 * checking of the answer are the SDK's (crates/sdk, docs/SDK.md).
 */
export class Api {
  /** `ping` answers whether the server is reachable (open endpoint, no token). */
  constructor(
    private caller: Caller,
    private ping: () => Promise<boolean> = async () => true,
  ) {}

  private op<T>(op: string, args?: Record<string, unknown>) {
    return this.caller.call<T>(op, args);
  }

  /** Open endpoint: checks the server is reachable, without needing the token. */
  health(): Promise<boolean> {
    return this.ping();
  }

  transactions() {
    return this.op<Transaction[]>("list_transactions");
  }

  /** Hand a file to a provider with the `file` flow (`csv`: the bank's export, as the bytes it came in; it may not be UTF-8). */
  importFile(kind: "csv", bytes: ArrayBuffer) {
    return this.op<ImportReport>("import_file", { kind, csv_base64: toBase64(bytes) });
  }

  recurring() {
    return this.op<Recurring[]>("recurring");
  }

  /**
   * The budget in one call: the period (payday to payday), every envelope with its limit and what was spent,
   * the daily number (`safe_to_spend`, only for the current period) and the monthly picture (`disposable`).
   * `date` is the local day, so a late evening is not tomorrow.
   */
  budget(period: "current" | "previous" = "current", date?: string) {
    return this.op<Budget>("budget", { period, date });
  }

  /** Replace all envelope limits; answers with the envelopes of the current period. */
  saveEnvelopes(envelopes: Envelope[]) {
    return this.op<EnvelopeStatus[]>("put_envelopes", { body: envelopes });
  }

  /** Where the current budget period is heading; `date` is the local day. */
  forecast(date?: string) {
    return this.op<Forecast>("forecast", { date });
  }

  prices(item?: string) {
    return this.op<Price[]>("list_prices", { item });
  }

  /** What a scanned barcode (EAN-8, EAN-13, UPC-A) costs per chain. 400 for an invalid barcode. */
  eanLookup(ean: string) {
    return this.op<EanLookup>("ean_lookup", { ean });
  }

  refreshPrices() {
    return this.op<RefreshReport>("refresh_prices");
  }

  catalog() {
    return this.op<CatalogItem[]>("catalog");
  }

  basket() {
    return this.op<Basket>("get_basket");
  }

  saveBasket(items: BasketItem[]) {
    return this.op<Basket>("put_basket", { body: items });
  }

  receipts() {
    return this.op<Receipt[]>("list_receipts");
  }

  uploadReceipt(text: string) {
    return this.op<Receipt>("upload_receipt", { body: { text } });
  }

  /** Photo of a receipt: a vision model transcribes it and the server parses the transcript. */
  scanReceipt(imageBase64: string, mimeType: string) {
    return this.op<ScanResult>("scan_receipt", { body: { image_base64: imageBase64, mime_type: mimeType } });
  }

  deleteReceipt(id: number) {
    return this.op<void>("delete_receipt", { id });
  }

  /** Every receipt source (mailbox, folder, Lidl Plus, Kaufland Card, REWE, orders file), its `flow` and how it is doing. */
  receiptSources() {
    return this.op<ReceiptSource[]>("list_sources");
  }

  /** One source. */
  receiptSource(kind: SourceKind) {
    return this.op<ReceiptSource>("get_source", { kind });
  }

  /** Run the enabled sources now, or just one. */
  syncReceipts(source?: string) {
    return this.op<ReceiptSync>("sync_now", source ? { body: { source } } : {});
  }

  /** `sign_in` sources: begin the sign-in; the returned address is the shop's own page. */
  connectSource(kind: SourceKind) {
    return this.op<SourceConnect>("connect_source", { kind });
  }

  /** `sign_in` sources: finish the sign-in with the address the page redirected to. */
  finishSource(kind: SourceKind, state: string, callbackUrl: string) {
    return this.op<ReceiptSource>("finish_source", { kind, body: { state, callback_url: callbackUrl } });
  }

  /** Forget the connection (a stored token, or the note of the last push). Receipts already stored stay. */
  disconnectSource(kind: SourceKind) {
    return this.op<ReceiptSource>("disconnect_source", { kind });
  }

  /** `push` sources: which of the shop's receipt ids (read in the app's browser window) are not stored yet. */
  knownReceipts(kind: SourceKind, ids: string[]) {
    return this.op<components["schemas"]["ReceiptKnownDto"]>("known_receipts", { kind, body: { ids } });
  }

  /** `push` sources: store the receipts the app read (REWE's web shop) or the orders it read from a file (`shop` names the web shop, for `orders_file`). */
  importReceipts(kind: SourceKind, receipts: ReceiptInput[], shop?: string) {
    return this.op<ReceiptImport>("import_receipts", { kind, body: shop === undefined ? { receipts } : { shop, receipts } });
  }

  affordability(budgetCents?: number, daysPerBasket?: number) {
    return this.op<Affordability>("affordability", { budget_cents: budgetCents, days_per_basket: daysPerBasket });
  }

  recipes(opts: { budgetCents?: number; tag?: string; limit?: number } = {}) {
    return this.op<RecipeMatch[]>("recipes", { budget_cents: opts.budgetCents, tag: opts.tag || undefined, limit: opts.limit || undefined });
  }

  ideas(req: { count?: number; diet?: string; budget_cents?: number }) {
    return this.op<Idea[]>("recipe_ideas", { body: req });
  }

  /** The meals planned for the week that contains `week` (Monday to Sunday). */
  mealPlan(week: string) {
    return this.op<MealPlan>("get_meal_plan", { week });
  }

  /** Replaces the plan of the week; days that are not listed become empty. */
  saveMealPlan(week: string, days: MealDayInput[]) {
    return this.op<MealPlan>("put_meal_plan", { week, body: { days } });
  }

  /** Ingredients of the week's meals, priced per chain and checked against the groceries budget. `date` is the local day. */
  mealShoppingList(week: string, date?: string) {
    return this.op<MealShoppingList>("get_shopping_list", { week, date });
  }

  pantry() {
    return this.op<Pantry>("get_pantry");
  }

  /** Replaces the list of items assumed to be at home (catalog keys). */
  savePantry(items: string[]) {
    return this.op<Pantry>("put_pantry", { body: { items } });
  }

  settings() {
    return this.op<Settings>("get_settings");
  }

  /**
   * Every key of the server's financer.toml with its value and where it comes from. Answers 404 on
   * the on-phone backend, which has no such file.
   */
  serverConfig() {
    return this.op<components["schemas"]["ConfigDto"]>("get_config");
  }

  /**
   * Save changes to the server's configuration. The server checks them first (HTTP 422 with
   * `problems` when it refuses; 409 when an environment variable decides a key), then restarts to
   * apply them.
   */
  saveServerConfig(change: components["schemas"]["ConfigChangeInput"]) {
    return this.op<components["schemas"]["ConfigSavedDto"]>("put_config", { body: change });
  }

  saveSettings(update: SettingsUpdate) {
    return this.op<Settings>("put_settings", { body: update });
  }

  /** Calendar of expected charges for the next `days` days, price hikes, duplicates and stopped subscriptions. */
  subscriptions(days?: number) {
    return this.op<Subscriptions>("subscriptions", { days: days || undefined });
  }

  /** Anomaly alerts; dismissed ones only with `includeDismissed`. */
  alerts(includeDismissed = false) {
    return this.op<AlertList>("alerts", { include_dismissed: includeDismissed || undefined });
  }

  dismissAlert(id: string) {
    return this.op<{ id: string; dismissed: boolean }>("dismiss_alert", { id });
  }

  /** Everything that is yours as one document (no secrets, no prices). */
  exportData() {
    return this.op<ExportData>("export_data");
  }

  importData(data: ExportData) {
    return this.op<ImportSummary>("import_data", { body: data });
  }

  /** The same data as `exportData`, encrypted with a passphrase (an `age` file, base64). */
  createBackup(passphrase: string) {
    return this.op<EncryptedBackup>("create_backup", { body: { passphrase } });
  }

  /** Merge an encrypted backup; a wrong passphrase or damaged file is a 400 and changes nothing. */
  restoreBackup(passphrase: string, dataBase64: string) {
    return this.op<ImportSummary>("restore_backup", { body: { passphrase, data_base64: dataBase64 } });
  }

  /** What the last login sent with a request looked like (non-secret), to prefill a form. */
  bankStatus() {
    return this.op<BankStatus>("bank_status");
  }

  /** Every way transactions come in, how each works (`file`, `approval`, `link`) and whether this server has it. */
  providers() {
    return this.op<ProviderInfo[]>("list_providers");
  }

  /** The bank connections of the server's financer.toml, without secrets. Empty when none is configured. */
  bankConnections() {
    return this.op<BankConnection[]>("list_connections");
  }

  /**
   * Start a sync, whichever provider: name a `connection` of the server's configuration, or for FinTS a
   * `kind` with a `login`. The server then waits for the approval in the banking app (`needs_approval`) or
   * for the sign-in on the provider's page (`needs_link`, with `link_url`) and imports by itself. Send
   * `pin` only when the connection has no `pin_from_env`.
   */
  startSync(req: SyncRequest) {
    return this.op<Sync>("start_sync", { body: req });
  }

  /** Where a sync stands. Ask while its `state` is `syncing`, `needs_approval` or `needs_link`. */
  syncStatus(id: string) {
    return this.op<Sync>("get_sync", { id });
  }

  /** Stop waiting for an approval or a sign-in. */
  cancelSync(id: string) {
    return this.op<Sync>("cancel_sync", { id });
  }

  /** Plaid, GoCardless, finAPI: forget the connection (the server tells the provider and deletes its access). Imported transactions stay. */
  disconnectConnection(name: string) {
    return this.op<BankConnection>("disconnect_connection", { name });
  }

  /** Spending per supermarket chain for the current/previous budget period or the last `n` periods. `date` is the local day. */
  storeSpending(period: StoresPeriod = "current", opts: { n?: number; date?: string } = {}) {
    return this.op<StoreSpending>("store_spending", Api.storeArgs({ period, ...opts }));
  }

  /** The bookings behind one chain's total (`other` = groceries no chain matched), newest first. */
  storeTransactions(chain: string, period: StoresPeriod = "current", opts: { n?: number; date?: string } = {}) {
    return this.op<Transaction[]>("store_transactions", { chain, ...Api.storeArgs({ period, ...opts }) });
  }

  private static storeArgs(p: Page) {
    return { period: p.period, n: p.period === "last_n" && p.n ? p.n : undefined, date: p.date || undefined };
  }

  /**
   * Where the shopping assistant's current subscription plans end (a phone or internet contract).
   * The assistant runs under `/v1/shop` on the same server when the build has it; without it, or
   * without a plan, the answer is an empty list.
   */
  async shopContracts(): Promise<{ category: string; name: string; plan: string | null; endsOn: string }[]> {
    try {
      const categories = await this.caller.call<{ id: string; name: string; kind: string }[]>("shop.categories");
      const out: { category: string; name: string; plan: string | null; endsOn: string }[] = [];
      for (const c of categories.filter((x) => x.kind === "subscription")) {
        const plan = await this.caller.call<{ name?: string | null; ends_on?: string | null } | null>("shop.my_plan", { category: c.id });
        if (plan?.ends_on) out.push({ category: c.id, name: c.name, plan: plan.name ?? null, endsOn: plan.ends_on });
      }
      return out;
    } catch {
      return [];
    }
  }

  // ---- calendar ----

  calendars() {
    return this.op<Calendar[]>("list_calendars");
  }

  createCalendar(calendar: CalendarInput) {
    return this.op<Calendar>("create_calendar", { body: calendar });
  }

  updateCalendar(id: number, calendar: CalendarInput) {
    return this.op<Calendar>("update_calendar", { id, body: calendar });
  }

  deleteCalendar(id: number) {
    return this.op<void>("delete_calendar", { id });
  }

  /** Events that can show between two days (`YYYY-MM-DD`, inclusive); repeating ones come as one rule. */
  calendarEvents(from: string, to: string) {
    return this.op<CalendarEvent[]>("list_events", { from, to });
  }

  createEvent(event: CalendarEventInput) {
    return this.op<CalendarEvent>("create_event", { body: event });
  }

  updateEvent(id: number, event: CalendarEventInput) {
    return this.op<CalendarEvent>("update_event", { id, body: event });
  }

  deleteEvent(id: number) {
    return this.op<void>("delete_event", { id });
  }

  /** Delete one occurrence of a repeating event. */
  skipOccurrence(id: number, date: string) {
    return this.op<CalendarEvent>("add_exception", { id, body: { date } });
  }

  // ---- categorization: rules, corrections, splits, AI suggestions ----

  rules() {
    return this.op<Rule[]>("list_rules");
  }

  createRule(rule: RuleInput) {
    return this.op<Rule>("create_rule", { body: rule });
  }

  updateRule(id: number, rule: RuleInput) {
    return this.op<Rule>("update_rule", { id, body: rule });
  }

  deleteRule(id: number) {
    return this.op<void>("delete_rule", { id });
  }

  /** `ids` lists every rule once, highest priority first. */
  reorderRules(ids: number[]) {
    return this.op<Rule[]>("reorder_rules", { body: { ids } });
  }

  /** Re-run the rules over existing transactions; resolves with how many changed. */
  applyRules() {
    return this.op<{ changed: number }>("apply_rules");
  }

  /** `remember` also makes a rule for the merchant and applies it to its other transactions. */
  setCategory(id: number, category: string, remember: boolean) {
    return this.op<CategoryChanged>("set_category", { id, body: { category, remember } });
  }

  splits() {
    return this.op<Split[]>("list_splits");
  }

  putSplit(id: number, split: SplitInput) {
    return this.op<Split>("put_split", { id, body: split });
  }

  deleteSplit(id: number) {
    return this.op<void>("delete_split", { id });
  }

  /** Asks the configured AI for categories of merchants nothing placed; sends merchant names only. */
  suggestCategories() {
    return this.op<Suggestions>("categorize_unknown");
  }

  acceptSuggestions(suggestions: { merchant: string; category: string }[]) {
    return this.op<AcceptReport>("accept_suggestions", { body: { suggestions } });
  }
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
}
