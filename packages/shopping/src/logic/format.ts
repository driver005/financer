// Texts for prices, discounts and ages. The app is English with German number formatting,
// like the finance app.

import type { DealInfo, Offer, Verdict } from "../api/types";

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const euros = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${euros},${(abs % 100).toString().padStart(2, "0")} €`;
}

/** `649,00 €`, or `19,99 € / month` for plans (`perMonth`). */
export function formatPrice(cents: number | null | undefined, perMonth = false): string {
  if (cents === null || cents === undefined) return "no price";
  return perMonth ? `${formatCents(cents)} / month` : formatCents(cents);
}

export function formatPercent(pct: number): string {
  return `${Math.round(pct)} %`;
}

/** `Save 12,34 € a month (296,16 € over 24 months)`, or the opposite when it would cost more. */
export function savingText(perMonthCents: number, overHorizonCents: number, months: number, current?: string | null): string {
  const from = current ? ` than ${current}` : " than now";
  if (perMonthCents > 0) {
    return `Save ${formatCents(perMonthCents)} a month (${formatCents(overHorizonCents)} over ${months} months)`;
  }
  if (perMonthCents < 0) return `${formatCents(-perMonthCents)} a month more${from}`;
  return `Same cost${from}`;
}

const VERDICT_TEXT: Record<Verdict, string> = {
  none: "No deal",
  fair: "Slightly below its usual price",
  good: "Good deal",
  great: "Great deal",
};

export function verdictText(v: Verdict): string {
  return VERDICT_TEXT[v];
}

/** One line on why a price is or is not a deal. */
export function dealLine(d: DealInfo): string {
  if (d.verdict === "none") return d.samples >= 3 ? "Priced as usual" : "Not enough price history yet";
  const parts = [`${formatPercent(d.discount_pct)} below its usual price`];
  if (d.all_time_low) parts.push("lowest we have seen");
  else if (d.lowest_90d) parts.push("lowest in 90 days");
  return parts.join(", ");
}

const UNITS: [number, string][] = [
  [86_400, "day"],
  [3_600, "hour"],
  [60, "minute"],
];

/** `3 days ago`, `just now`. */
export function ago(unixSeconds: number, nowSeconds: number): string {
  const diff = Math.max(0, nowSeconds - unixSeconds);
  for (const [size, name] of UNITS) {
    if (diff >= size) {
      const n = Math.floor(diff / size);
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

export function cheapestOffer(offers: Offer[]): Offer | undefined {
  return offers
    .filter((o) => o.in_stock !== false)
    .sort((a, b) => a.price_cents - b.price_cents)[0];
}

/** The contract of a plan in words: `24 months, 6 months at 9,99 €, 39,99 € to set up`. */
export function planTerms(o: Offer): string {
  const r = o.recurring;
  if (!r) return "";
  const parts: string[] = [];
  parts.push(r.min_term_months ? `${r.min_term_months} months` : "cancel monthly");
  if (r.promo_months && r.promo_monthly_cents !== undefined && r.promo_monthly_cents !== null) {
    parts.push(`first ${r.promo_months} months at ${formatCents(r.promo_monthly_cents)}`);
  }
  if (r.setup_cents) parts.push(`${formatCents(r.setup_cents)} to set up`);
  if (r.cashback_cents) parts.push(`${formatCents(r.cashback_cents)} cash back`);
  return parts.join(", ");
}
