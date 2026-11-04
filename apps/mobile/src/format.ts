// Formatting lives in Rust (crates/logic, format.rs): the rule for how an amount, a date or a count is
// written. These are the typed entries the screens call.
import { logic } from "../../../packages/wire/src/logic";

/** `-2347` -> `-23,47 €` (German notation, integer cents in, no floats). */
export const formatCents = (cents: number): string => logic("format.format_cents", { cents });

/**
 * Money for display: German notation, a real minus sign and a non-breaking space before the euro sign.
 * A positive amount gets a `+` only with `signed`; zero has no sign.
 */
export const formatMoney = (cents: number, opts: { signed?: boolean } = {}): string => logic("format.format_money", { cents, signed: opts.signed ?? false });

export type MoneyTone = "income" | "expense" | "zero";

/** Which colour role an amount takes: income (green), expense (the normal text colour or red) or none. */
export const moneyTone = (cents: number): MoneyTone => logic("format.money_tone", { cents });

/** How a screen reader should say an amount: `minus 23,47 euros`. */
export const spokenMoney = (cents: number): string => logic("format.spoken_money", { cents });

/** The parts of an amount, for a hero figure with big euros and small cents. */
export const splitMoney = (cents: number): { sign: string; whole: string; fraction: string } => logic("format.split_money", { cents });

/** Heading of a day group in a list: `Today`, `Yesterday`, else `Mon 12.10.2026`. Dates are `YYYY-MM-DD`. */
export const dayHeading = (iso: string, today: string): string => logic("format.day_heading", { iso, today });

/** `2026-03-02` -> `02.03.2026` */
export const formatDate = (iso: string): string => logic("format.format_date", { iso });

/** Parse German or plain euro input (`40`, `40,50`, `1.234,5`) into cents; `null` if invalid. */
export const parseEuroInput = (input: string): number | null => logic("format.parse_euro_input", { input });

/** "1 serving", "2 servings". */
export const servingsText = (n: number): string => logic("format.servings_text", { n });
