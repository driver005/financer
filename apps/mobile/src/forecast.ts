/**
 * Wording for the end-of-period forecast card. The numbers and the warning all come from the
 * server (`GET /v1/forecast`, see crates/core/src/forecast.rs); this only turns them into
 * sentences, so the card never disagrees with the server about the level or the run-out date.
 */
import type { Forecast } from "./api/client";
import { formatCents, formatDate } from "./format";

export type ForecastTone = "good" | "warn" | "bad" | "muted";

export type ForecastView = {
  tone: ForecastTone;
  /** Short badge text: "On track", "Keep an eye on it", "Heading for a shortfall". */
  status: string;
  /** The big number; `null` when there is nothing to project yet. */
  amountCents: number | null;
  /** What the big number means, e.g. "left at the end of the period". */
  amountLabel: string;
  /** The reason for the warning level, in plain language. */
  reason: string;
  /** About the grocery budget; `null` without a grocery limit. */
  groceries: string | null;
  /** Caveat for the first days of a period; `null` otherwise. */
  early: string | null;
};

/** `19.10.` from `2026-10-19`. */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / DAY_MS);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The sentence about the grocery budget, or `null` when there is no grocery limit. */
export function groceryText(f: Forecast): string | null {
  if (f.grocery_limit_cents == null) return null;
  if (f.grocery_exhausted) {
    // shortDate ends in a dot, which doubles as the end of the sentence
    const day = f.grocery_run_out ? ` on ${shortDate(f.grocery_run_out)}` : ".";
    return `Your grocery budget of ${formatCents(f.grocery_limit_cents)} was used up${day}`;
  }
  if (f.grocery_run_out) {
    const before = daysBetween(f.grocery_run_out, f.period_end);
    return `At this pace the grocery budget runs out on ${shortDate(f.grocery_run_out)}, ${plural(before, "day", "days")} before the period ends.`;
  }
  if (f.grocery_spent_cents === 0) return "No grocery spending yet, so the budget is untouched.";
  return "The grocery budget should last until the period ends.";
}

/** Everything the forecast card shows. */
export function forecastView(f: Forecast): ForecastView {
  const groceries = groceryText(f);
  const early =
    f.early && f.days_after_today > 0 && f.reason !== "no_data"
      ? `Only ${plural(f.days_through, "day", "days")} of this period ${f.days_through === 1 ? "is" : "are"} over, so this is a rough guess.`
      : null;

  const base = { groceries, early };
  switch (f.reason) {
    case "no_data":
      return {
        ...base,
        tone: "muted",
        status: "Not enough data",
        amountCents: null,
        amountLabel: "",
        reason: "Import some bookings and I can tell how this period will end.",
        early: null,
      };
    case "no_income":
      return {
        ...base,
        tone: "muted",
        status: "Income unknown",
        amountCents: null,
        amountLabel: "",
        reason: "No recurring income found in your bookings, so there is nothing to compare your spending with.",
      };
    case "projected_shortfall": {
      const short = -f.projected_leftover_cents;
      return {
        ...base,
        tone: f.level === "danger" ? "bad" : "warn",
        status: f.level === "danger" ? "Heading for a shortfall" : "Could end short",
        amountCents: f.projected_leftover_cents,
        amountLabel: "projected at the end of the period",
        reason: `At the current pace you would end the period ${formatCents(short)} short.`,
      };
    }
    case "income_overdue":
      return {
        ...base,
        tone: "warn",
        status: "Income is late",
        amountCents: f.projected_leftover_cents,
        amountLabel: "left at the end if it arrives",
        reason: `Your income of ${formatCents(f.income_upcoming_cents)} was expected on ${f.next_income_date ? formatDate(f.next_income_date) : "an earlier day"} and is not booked yet.`,
      };
    case "groceries_run_out":
      return {
        ...base,
        tone: "warn",
        status: "Keep an eye on groceries",
        amountCents: f.projected_leftover_cents,
        amountLabel: "left at the end of the period",
        reason: groceries ?? "The grocery budget runs out before the period ends.",
      };
    case "thin_margin":
      return {
        ...base,
        tone: "warn",
        status: "Tight month",
        amountCents: f.projected_leftover_cents,
        amountLabel: "left at the end of the period",
        reason: `Only ${formatCents(f.projected_leftover_cents)} would be left, a very small cushion.`,
      };
    case "income_pending":
      return {
        ...base,
        tone: "good",
        status: "On track",
        amountCents: f.projected_leftover_cents,
        amountLabel: "left at the end of the period",
        reason: `Counting on ${formatCents(f.income_upcoming_cents)} arriving${f.next_income_date ? ` on ${formatDate(f.next_income_date)}` : ""}.`,
      };
    case "on_track":
    default:
      return {
        ...base,
        tone: "good",
        status: "On track",
        amountCents: f.projected_leftover_cents,
        amountLabel: "left at the end of the period",
        reason: `At the current pace you end the period with ${formatCents(f.projected_leftover_cents)} to spare.`,
      };
  }
}
