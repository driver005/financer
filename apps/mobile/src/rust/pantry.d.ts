/* tslint:disable */
/* eslint-disable */

export function wasm_assistant(question: string, rows_json: string, budgets_json: string): string;

export function wasm_bill_confirm(bill_cents: bigint, paid_cents: bigint): string;

export function wasm_budget_status(budgets_json: string, spending_json: string): string;

export function wasm_build_list(purchases_json: string, offers_json: string, scope: string): string;

export function wasm_category_totals(rows_json: string, prefix: string): string;

export function wasm_chat_command(text: string): string;

export function wasm_checklist_status(goals_json: string, items_json: string): string;

export function wasm_combined_summary(own_json: string, partner_json: string): string;

export function wasm_compare_months(rows_json: string, current: string, previous: string): string;

export function wasm_convert(cents: bigint, from: string, to: string, rates_json: string): bigint | undefined;

export function wasm_credit_payoff(balance_cents: bigint, monthly_cents: bigint, apr_percent: number): string;

export function wasm_csv_export(rows_json: string): string;

export function wasm_debt_summary(rows_json: string): string;

export function wasm_due_soon(rows_json: string, today: string, days: bigint): string;

export function wasm_eval(text: string): bigint | undefined;

export function wasm_filter_tag(rows_json: string, tag: string): string;

export function wasm_forecast(prices_json: string, name: string, store: string, today: string): string;

export function wasm_format_euro(cents: bigint): string;

export function wasm_geo_summary(rows_json: string): string;

export function wasm_goal_status(goals_json: string): string;

export function wasm_gold_profit(grams: number, buy_cents: bigint, current_cents: bigint): string;

export function wasm_group_categories(rows_json: string, categories_json: string, prefix: string): string;

export function wasm_invoice_total(items_json: string, tax_percent: number): bigint;

export function wasm_ledger_balance(entries_json: string, account: string): bigint;

export function wasm_ledger_check(entries_json: string): string;

export function wasm_match_store(merchant: string, stores_json: string): string | undefined;

export function wasm_normalize_meal(meal_json: string): string;

export function wasm_optimize(prices_json: string, items_json: string, stores_json: string, today: string): string;

export function wasm_parse_euro(text: string): bigint | undefined;

export function wasm_parse_offers(text: string, store_id: string, today: string, source: string): string;

export function wasm_parse_purchases(text: string, store_id: string): string;

export function wasm_parse_receipt(text: string): string;

export function wasm_parse_transaction_csv(text: string): string;

export function wasm_paycheck_dates(start: string, frequency: string, count: bigint): string;

export function wasm_paycheck_history(paychecks_json: string, allocations_json: string): string;

export function wasm_paycheck_plan(take_home: bigint, rules_json: string): string;

export function wasm_paycheck_proration(amount_cents: bigint, frequency: string): bigint;

export function wasm_period_key(scope: string, y: bigint, m: bigint, d: bigint): string;

export function wasm_period_label(scope: string, key: string): string;

export function wasm_period_start_key(y: bigint, m: bigint, d: bigint, start: bigint): string;

export function wasm_period_start_label(key: string, start: bigint): string;

export function wasm_period_start_shift(key: string, by: bigint): string;

export function wasm_pin_hash(pin: string): string;

export function wasm_price_stats(prices_json: string, name: string, store: string): string;

export function wasm_project_funding(items_json: string, available: bigint): string;

export function wasm_receivable_status(rows_json: string, today: string): string;

export function wasm_report_csv(rows_json: string): string;

export function wasm_report_html(rows_json: string, title: string): string;

export function wasm_report_pdf(rows_json: string, title: string): string;

export function wasm_rollover_status(budgets_json: string, spending_json: string): string;

export function wasm_scale_amount(amount: string, servings: bigint, base: bigint): string;

export function wasm_schedule_recurring(rows_json: string, today: string, count: bigint): string;

export function wasm_scheduled(rows_json: string, today: string): string;

export function wasm_shift_period(scope: string, key: string, by: bigint): string;

export function wasm_spending_summary(rows_json: string, locale: string): string;

export function wasm_split_bill(cents: bigint, count: bigint, mode: string, shares_json: string): string;

export function wasm_store_summary(rows_json: string, store_id: string, month: string): string;

export function wasm_subscription_next(rows_json: string, today: string): string;

export function wasm_supermarkets(): string;

export function wasm_tx_totals(rows_json: string, prefix: string): string;

export function wasm_valuation_change(rows_json: string, account: string): bigint;

export function wasm_warranty_status(rows_json: string, today: string): string;

export function wasm_xlsx(rows_json: string): string;

export function wasm_xlsx_import(base64_data: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly wasm_assistant: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasm_bill_confirm: (a: bigint, b: bigint) => [number, number];
    readonly wasm_budget_status: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_build_list: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasm_category_totals: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_chat_command: (a: number, b: number) => [number, number];
    readonly wasm_checklist_status: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_combined_summary: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_compare_months: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasm_convert: (a: bigint, b: number, c: number, d: number, e: number, f: number, g: number) => [number, bigint];
    readonly wasm_credit_payoff: (a: bigint, b: bigint, c: number) => [number, number];
    readonly wasm_csv_export: (a: number, b: number) => [number, number];
    readonly wasm_debt_summary: (a: number, b: number) => [number, number];
    readonly wasm_due_soon: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
    readonly wasm_eval: (a: number, b: number) => [number, bigint];
    readonly wasm_filter_tag: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_forecast: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly wasm_format_euro: (a: bigint) => [number, number];
    readonly wasm_geo_summary: (a: number, b: number) => [number, number];
    readonly wasm_goal_status: (a: number, b: number) => [number, number];
    readonly wasm_gold_profit: (a: number, b: bigint, c: bigint) => [number, number];
    readonly wasm_group_categories: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasm_invoice_total: (a: number, b: number, c: number) => bigint;
    readonly wasm_ledger_balance: (a: number, b: number, c: number, d: number) => bigint;
    readonly wasm_ledger_check: (a: number, b: number) => [number, number];
    readonly wasm_match_store: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_normalize_meal: (a: number, b: number) => [number, number];
    readonly wasm_optimize: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly wasm_parse_euro: (a: number, b: number) => [number, bigint];
    readonly wasm_parse_offers: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly wasm_parse_purchases: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_parse_receipt: (a: number, b: number) => [number, number];
    readonly wasm_parse_transaction_csv: (a: number, b: number) => [number, number];
    readonly wasm_paycheck_dates: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
    readonly wasm_paycheck_history: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_paycheck_plan: (a: bigint, b: number, c: number) => [number, number];
    readonly wasm_paycheck_proration: (a: bigint, b: number, c: number) => bigint;
    readonly wasm_period_key: (a: number, b: number, c: bigint, d: bigint, e: bigint) => [number, number];
    readonly wasm_period_label: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_period_start_key: (a: bigint, b: bigint, c: bigint, d: bigint) => [number, number];
    readonly wasm_period_start_label: (a: number, b: number, c: bigint) => [number, number];
    readonly wasm_period_start_shift: (a: number, b: number, c: bigint) => [number, number];
    readonly wasm_pin_hash: (a: number, b: number) => [number, number];
    readonly wasm_price_stats: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasm_project_funding: (a: number, b: number, c: bigint) => [number, number];
    readonly wasm_receivable_status: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_report_csv: (a: number, b: number) => [number, number];
    readonly wasm_report_html: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_report_pdf: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_rollover_status: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_scale_amount: (a: number, b: number, c: bigint, d: bigint) => [number, number];
    readonly wasm_schedule_recurring: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
    readonly wasm_scheduled: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_shift_period: (a: number, b: number, c: number, d: number, e: bigint) => [number, number];
    readonly wasm_spending_summary: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_split_bill: (a: bigint, b: bigint, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasm_store_summary: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly wasm_subscription_next: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_supermarkets: () => [number, number];
    readonly wasm_tx_totals: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_valuation_change: (a: number, b: number, c: number, d: number) => bigint;
    readonly wasm_warranty_status: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasm_xlsx: (a: number, b: number) => [number, number];
    readonly wasm_xlsx_import: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
