// Texts for prices, discounts and ages. The app is English with German number formatting, like the
// finance app. The rules are in Rust (crates/logic, shop_format.rs); a link check stays here.

import { logic } from "../../../wire/src/logic";
import type { DealInfo, Offer } from "../api/types";

export const formatCents = (cents: number): string => logic("shop_format.format_cents", { cents });
export const formatPercent = (pct: number): string => logic("shop_format.format_percent", { pct });

/** `Save 12,34 € a month (296,16 € over 24 months)`, or the opposite when it would cost more. */
export const savingText = (perMonthCents: number, overHorizonCents: number, months: number, current?: string | null): string =>
  logic("shop_format.saving_text", { per_month_cents: perMonthCents, over_horizon_cents: overHorizonCents, months, current: current ?? null });
/** One line on why a price is or is not a deal. */
export const dealLine = (d: DealInfo): string => logic("shop_format.deal_line", { d });

/** `3 days ago`, `just now`. */
export const ago = (unixSeconds: number, nowSeconds: number): string =>
  logic("shop_format.ago", { unix_seconds: unixSeconds, now_seconds: nowSeconds });
/** The contract of a plan in words: `24 months, 6 months at 9,99 €, 39,99 € to set up`. */
export const planTerms = (o: Offer): string => logic("shop_format.plan_terms", { o });

/** A link from a shop page is opened only when it is a web address. */
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
