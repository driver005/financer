/** `-2347` -> `-23,47 €` (German notation, integer cents in, no floats). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${euros},${(abs % 100).toString().padStart(2, "0")} €`;
}

const NBSP = " ";
const MINUS = "−";

/**
 * Money for display: German notation, a real minus sign (not a hyphen) and a non-breaking space
 * before the euro sign, so an amount never wraps with the `€` alone on the next line. A positive
 * amount gets a `+` only with `signed` (used where income and spending mix); zero has no sign.
 * `formatCents` stays for places that want the plain string.
 */
export function formatMoney(cents: number, opts: { signed?: boolean } = {}): string {
  const body = formatCents(Math.abs(cents)).replace(" ", NBSP);
  if (cents < 0) return `${MINUS}${body}`;
  return opts.signed && cents > 0 ? `+${body}` : body;
}

export type MoneyTone = "income" | "expense" | "zero";

/** Which colour role an amount takes: income (green), expense (the normal text colour or red) or none. */
export function moneyTone(cents: number): MoneyTone {
  return cents > 0 ? "income" : cents < 0 ? "expense" : "zero";
}

/** How a screen reader should say an amount: `minus 23,47 euros`. */
export function spokenMoney(cents: number): string {
  const abs = formatCents(Math.abs(cents)).replace(" €", "");
  return `${cents < 0 ? "minus " : ""}${abs} euros`;
}

/** The parts of an amount, for a hero figure with big euros and small cents: `-1.234,56` -> `{ sign: "-", whole: "1.234", fraction: "56" }`. */
export function splitMoney(cents: number): { sign: string; whole: string; fraction: string } {
  const [whole, fraction] = formatCents(Math.abs(cents)).replace(" €", "").split(",");
  return { sign: cents < 0 ? MINUS : "", whole, fraction };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Heading of a day group in a list: `Today`, `Yesterday`, else `Mon 12.10.2026`. Dates are `YYYY-MM-DD`. */
export function dayHeading(iso: string, today: string): string {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const diff = Math.round((ms(today) - ms(iso)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return `${WEEKDAYS[new Date(ms(iso)).getUTCDay()]} ${formatDate(iso)}`;
}

/** `2026-03-02` -> `02.03.2026` */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Parse German or plain euro input (`40`, `40,50`, `1.234,5`) into cents; `null` if invalid. */
export function parseEuroInput(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null;
  const [int, frac = ""] = s.replace(/\./g, "").split(",");
  return Number(int) * 100 + Number(frac.padEnd(2, "0"));
}

/** "1 serving", "2 servings". */
export function servingsText(n: number): string {
  return `${n} ${n === 1 ? "serving" : "servings"}`;
}
