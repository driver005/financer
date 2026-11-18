/**
 * Rust business logic for Pantry. Expo only draws screens; all calculations run in this
 * WebAssembly module built from crates/pantry-core.
 */

import { WASM_BASE64 } from "./wasmBytes";
import { coreFallback } from "./coreFallback";

/** Hermes (React Native) has no WebAssembly engine; the browser build uses the Rust core. */
const forceNativeFallback = typeof location !== "undefined" && /[?&]native=1/.test(location.search);
const hasWasm = !forceNativeFallback && typeof WebAssembly !== "undefined" && typeof WebAssembly.Module === "function";

type PantryModule = typeof import("./pantry");
const pantry: PantryModule | null = hasWasm ? (require("./pantry") as PantryModule) : null;

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/[^A-Za-z0-9+/=]/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - padding);
  let index = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = alphabet.indexOf(clean[i]);
    const b = alphabet.indexOf(clean[i + 1]);
    const c = clean[i + 2] === "=" ? 0 : alphabet.indexOf(clean[i + 2]);
    const d = clean[i + 3] === "=" ? 0 : alphabet.indexOf(clean[i + 3]);
    if (index < out.length) out[index++] = (a << 2) | (b >> 4);
    if (index < out.length) out[index++] = ((b & 15) << 4) | (c >> 2);
    if (index < out.length) out[index++] = ((c & 3) << 6) | d;
  }
  return out;
}

if (pantry) pantry.initSync({ module: decodeBase64(WASM_BASE64) });

function json<T>(value: string): T {
  return JSON.parse(value) as T;
}

const wasmCore = {
  periodKey(scope: "week" | "month", date: Date): string {
    const [y, m, d] = [date.getFullYear(), date.getMonth() + 1, date.getDate()];
    return pantry!.wasm_period_key(scope, BigInt(y), BigInt(m), BigInt(d));
  },
  monthKey(date: Date): string {
    return pantry!.wasm_period_key("month", BigInt(date.getFullYear()), BigInt(date.getMonth() + 1), BigInt(date.getDate()));
  },
  shiftPeriod(scope: "week" | "month", key: string, by: number): string {
    return pantry!.wasm_shift_period(scope, key, BigInt(by));
  },
  periodLabel(scope: "week" | "month", key: string): string {
    return pantry!.wasm_period_label(scope, key);
  },
  parseEuro(text: string): number | null {
    const value = pantry!.wasm_parse_euro(text);
    return value === undefined ? null : Number(value);
  },
  formatEuro(cents: number): string {
    return pantry!.wasm_format_euro(BigInt(Math.round(cents)));
  },
  formatMoney(cents: number, code: string): string {
    return pantry!.wasm_format_euro(BigInt(Math.round(cents))).replace(" €", ` ${code}`);
  },
  scaleAmount(amount: string, servings: number, base: number): string {
    return pantry!.wasm_scale_amount(amount, BigInt(servings), BigInt(base));
  },
  supermarkets(): { id: string; name: string; aliases: string; active: number }[] {
    return json(pantry!.wasm_supermarkets());
  },
  matchStore(merchant: string, stores: unknown): string | null {
    return pantry!.wasm_match_store(merchant, JSON.stringify(stores)) ?? null;
  },
  parseOffers(text: string, storeId: string, today = new Date().toISOString().slice(0, 10), source = "paste") {
    return json<Record<string, unknown>[]>(pantry!.wasm_parse_offers(text, storeId, today, source));
  },
  xlsxImport(base64Data: string) {
    return json<{ date: string; merchant: string; amountCents: number; category: string; kind: string }[]>(pantry!.wasm_xlsx_import(base64Data));
  },
  chatCommand(text: string) {
    return json<{ command: string; kind: string; cents: number; category: string; merchant: string }>(pantry!.wasm_chat_command(text));
  },
  goldProfit(grams: number, buyCents: number, currentCents: number) {
    return json<{ cost: number; value: number; profit: number }>(pantry!.wasm_gold_profit(grams, BigInt(Math.round(buyCents)), BigInt(Math.round(currentCents))));
  },
  receivableStatus(rows: unknown) {
    return json<{ name: string; remaining: number; dueDate: string; overdue: boolean }[]>(pantry!.wasm_receivable_status(JSON.stringify(rows), new Date().toISOString().slice(0, 10)));
  },
  subscriptionNext(rows: unknown) {
    return json<{ name: string; amountCents: number; interval: string; nextDate: string }[]>(pantry!.wasm_subscription_next(JSON.stringify(rows), new Date().toISOString().slice(0, 10)));
  },
  projectFunding(items: unknown, availableCents: number) {
    return json<{ items: { name: string; cents: number; funded: boolean }[]; unused: number }>(pantry!.wasm_project_funding(JSON.stringify(items), BigInt(Math.round(availableCents))));
  },
  billConfirm(billCents: number, paidCents: number) {
    return json<{ difference: number; overage: number; shortfall: number; recoveryPlan: string }>(pantry!.wasm_bill_confirm(BigInt(billCents), BigInt(paidCents)));
  },
  creditPayoff(balanceCents: number, monthlyCents: number, aprPercent = 18) {
    return json<{ months: number; interest: number }>(pantry!.wasm_credit_payoff(BigInt(balanceCents), BigInt(monthlyCents), aprPercent));
  },
  paycheckHistory(paychecks: unknown, allocations: unknown) {
    return json<{ date: string; takeHome: number; planned: number; guiltFree: number }[]>(pantry!.wasm_paycheck_history(JSON.stringify(paychecks), JSON.stringify(allocations)));
  },
  spendingSummary(rows: unknown, locale = "en"): string { return pantry!.wasm_spending_summary(JSON.stringify(rows), locale); },
  paycheckDates(start: string, frequency: string, count = 6): string[] { return json<string[]>(pantry!.wasm_paycheck_dates(start, frequency, BigInt(count))); },
  paycheckProration(amountCents: number, frequency: string): number { return Number(pantry!.wasm_paycheck_proration(BigInt(Math.round(amountCents)), frequency)); },
  scheduleRecurring(rows: unknown, count = 6) {
    return json<{ name: string; dates: string[] }[]>(pantry!.wasm_schedule_recurring(JSON.stringify(rows), new Date().toISOString().slice(0, 10), BigInt(count)));
  },
  paycheckPlan(takeHomeCents: number, rules: unknown) {
    return json<{ label: string; cents: number; kind: string }[]>(pantry!.wasm_paycheck_plan(BigInt(Math.round(takeHomeCents)), JSON.stringify(rules)));
  },
  checklistStatus(goals: unknown, items: unknown) {
    return json<{ id: number; name: string; done: number; total: number; plan: number; paid: number }[]>(pantry!.wasm_checklist_status(JSON.stringify(goals), JSON.stringify(items)));
  },
  rolloverStatus(budgets: unknown, spending: unknown) {
    return json<{ category: string; limit: number; rollover: number; spent: number; available: number; remaining: number }[]>(pantry!.wasm_rollover_status(JSON.stringify(budgets), JSON.stringify(spending)));
  },
  invoiceTotal(items: unknown, taxPercent = 0): number { return Number(pantry!.wasm_invoice_total(JSON.stringify(items), taxPercent)); },
  valuationChange(rows: unknown, account: string): number { return Number(pantry!.wasm_valuation_change(JSON.stringify(rows), account)); },
  compareMonths(rows: unknown, current: string, previous: string) {
    return json<{ current: number; previous: number; categories: { category: string; current: number; previous: number; changePercent: number }[] }>(
      pantry!.wasm_compare_months(JSON.stringify(rows), current, previous),
    );
  },
  periodStartKey(date: Date, startDay: number): string {
    return pantry!.wasm_period_start_key(BigInt(date.getFullYear()), BigInt(date.getMonth() + 1), BigInt(date.getDate()), BigInt(startDay));
  },
  periodStartShift(key: string, by: number): string { return pantry!.wasm_period_start_shift(key, BigInt(by)); },
  periodStartLabel(key: string, startDay: number): string { return pantry!.wasm_period_start_label(key, BigInt(startDay)); },
  xlsx(rows: unknown): string { return pantry!.wasm_xlsx(JSON.stringify(rows)); },
  assistant(question: string, rows: unknown, budgets: unknown): string {
    return pantry!.wasm_assistant(question, JSON.stringify(rows), JSON.stringify(budgets));
  },
  combinedSummary(own: unknown, partner: unknown) {
    return json<{ ownExpense: number; partnerExpense: number; totalExpense: number; ownIncome: number; partnerIncome: number; totalIncome: number }>(
      pantry!.wasm_combined_summary(JSON.stringify(own), JSON.stringify(partner)),
    );
  },
  ledgerBalance(entries: unknown, account: string): number { return Number(pantry!.wasm_ledger_balance(JSON.stringify(entries), account)); },
  ledgerCheck(entries: unknown) { return json<{ balanced: boolean; problems: string[] }>(pantry!.wasm_ledger_check(JSON.stringify(entries))); },
  goalStatus(goals: unknown) {
    return json<{ name: string; target: number; saved: number; remaining: number; percent: number; daysLeft: number }[]>(pantry!.wasm_goal_status(JSON.stringify(goals)));
  },
  groupCategories(rows: unknown, categories: unknown, prefix: string) {
    return json<{ category: string; cents: number }[]>(pantry!.wasm_group_categories(JSON.stringify(rows), JSON.stringify(categories), prefix));
  },
  filterTag(rows: unknown, tag: string) { return json<unknown[]>(pantry!.wasm_filter_tag(JSON.stringify(rows), tag)); },
  geoSummary(rows: unknown) {
    return json<{ latitude: number; longitude: number; visits: number; total: number }[]>(pantry!.wasm_geo_summary(JSON.stringify(rows)));
  },
  warrantyStatus(rows: unknown) {
    return json<{ name: string; amountCents: number; warrantyUntil: string; daysLeft: number; expired: boolean }[]>(pantry!.wasm_warranty_status(JSON.stringify(rows), new Date().toISOString().slice(0, 10)));
  },
  pinHash(pin: string): string { return pantry!.wasm_pin_hash(pin); },
  convert(cents: number, from: string, to: string, rates: unknown): number | null {
    const value = pantry!.wasm_convert(BigInt(Math.round(cents)), from, to, JSON.stringify(rates));
    return value === undefined ? null : Number(value);
  },
  splitBill(cents: number, count: number, mode: "equal" | "amount" | "percent", shares: number[]): number[] {
    return json<number[]>(pantry!.wasm_split_bill(BigInt(Math.round(cents)), BigInt(count), mode, JSON.stringify(shares)));
  },
  parseReceipt(text: string) {
    return json<{ name: string; cents: number }[]>(pantry!.wasm_parse_receipt(text));
  },
  reportCsv(rows: unknown): string { return pantry!.wasm_report_csv(JSON.stringify(rows)); },
  reportHtml(rows: unknown, title: string): string { return pantry!.wasm_report_html(JSON.stringify(rows), title); },
  reportPdf(rows: unknown, title: string): string { return pantry!.wasm_report_pdf(JSON.stringify(rows), title); },
  dueSoon(rows: unknown, days = 7) {
    return json<unknown[]>(pantry!.wasm_due_soon(JSON.stringify(rows), new Date().toISOString().slice(0, 10), BigInt(days)));
  },
  debtSummary(rows: unknown) {
    return json<{ total: number; paid: number; remaining: number }>(pantry!.wasm_debt_summary(JSON.stringify(rows)));
  },
  evaluate(expression: string): number | null {
    const value = pantry!.wasm_eval(expression);
    return value === undefined ? null : Number(value);
  },
  txTotals(rows: unknown, prefix: string) {
    return json<{ income: number; expense: number; balance: number }>(pantry!.wasm_tx_totals(JSON.stringify(rows), prefix));
  },
  categoryTotals(rows: unknown, prefix: string) {
    return json<{ category: string; cents: number }[]>(pantry!.wasm_category_totals(JSON.stringify(rows), prefix));
  },
  budgetStatus(budgets: unknown, spending: unknown) {
    return json<{ category: string; limit: number; spent: number; remaining: number; percent: number }[]>(
      pantry!.wasm_budget_status(JSON.stringify(budgets), JSON.stringify(spending)),
    );
  },
  scheduled(rows: unknown, today = new Date().toISOString().slice(0, 10)) {
    return json<{ name: string; amountCents: number; category: string; nextDate: string }[]>(
      pantry!.wasm_scheduled(JSON.stringify(rows), today),
    );
  },
  csvExport(rows: unknown): string {
    return pantry!.wasm_csv_export(JSON.stringify(rows));
  },
  priceStats(prices: unknown, name: string, store: string) {
    return json<{ current: number; min: number; max: number; avg: number; series: { date: string; cents: number }[] }>(
      pantry!.wasm_price_stats(JSON.stringify(prices), name, store),
    );
  },
  forecast(prices: unknown, name: string, store: string, today = new Date().toISOString().slice(0, 10)) {
    return json<{ weekday: string; nextDate: string; expectedCents: number; buyNow: boolean; samples: number }>(
      pantry!.wasm_forecast(JSON.stringify(prices), name, store, today),
    );
  },
  optimize(prices: unknown, items: unknown, stores: string[], today = new Date().toISOString().slice(0, 10)) {
    return json<{ name: string; store: string; cents: number; savings: number; weekday: string; nextDate: string; buyNow: boolean }[]>(
      pantry!.wasm_optimize(JSON.stringify(prices), JSON.stringify(items), JSON.stringify(stores), today),
    );
  },
  parsePurchases(text: string, storeId: string) {
    return json<{ storeId: string; name: string; qty: string }[]>(pantry!.wasm_parse_purchases(text, storeId));
  },
  buildList(purchases: unknown, offers: unknown, scope: "week" | "month") {
    return json<{ name: string; qty: string; store: string; offerPrice: string | null; offerProduct: string | null }[]>(
      pantry!.wasm_build_list(JSON.stringify(purchases), JSON.stringify(offers), scope),
    );
  },
  normalizeMeal(meal: unknown) {
    return json<Record<string, unknown>>(pantry!.wasm_normalize_meal(JSON.stringify(meal)));
  },
  parseTransactionCsv(text: string) {
    return json<{ rows: unknown[]; errors: string[] }>(pantry!.wasm_parse_transaction_csv(text));
  },
  storeSummary(rows: unknown, storeId: string, month = new Date().toISOString().slice(0, 7)) {
    return json<{ visits: number; total: number; average: number }>(
      pantry!.wasm_store_summary(JSON.stringify(rows), storeId, month),
    );
  },
};

export const core = hasWasm ? wasmCore : coreFallback;
