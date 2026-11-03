// Number and date texts. The app is English with German number formatting, like the finance app.

/** `1.299,00 €`. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const euros = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${euros},${(abs % 100).toString().padStart(2, "0")} €`;
}

export function formatPercent(pct: number): string {
  return `${Math.round(pct)} %`;
}

const NBSP = "\u00a0";
const MINUS = "\u2212";

/**
 * Money for display: German notation, a real minus sign and a non-breaking space before the euro
 * sign, so an amount never wraps with the `€` alone on the next line. `signed` adds `+` to income.
 */
export function formatMoney(cents: number, opts: { signed?: boolean } = {}): string {
  const body = formatCents(Math.abs(cents)).replace(" ", NBSP);
  if (cents < 0) return `${MINUS}${body}`;
  return opts.signed && cents > 0 ? `+${body}` : body;
}

/** How a screen reader says an amount: `minus 23,47 euros`. */
export function spokenMoney(cents: number): string {
  const abs = formatCents(Math.abs(cents)).replace(" €", "");
  return `${cents < 0 ? "minus " : ""}${abs} euros`;
}

/** The parts of an amount, for a hero figure with big euros and small cents. */
export function splitMoney(cents: number): { sign: string; whole: string; fraction: string } {
  const [whole, fraction] = formatCents(Math.abs(cents)).replace(" €", "").split(",");
  return { sign: cents < 0 ? MINUS : "", whole, fraction };
}
