// The wording of the end-of-period forecast card lives in Rust (crates/logic, forecast.rs). The numbers
// and the warning all come from the server (`GET /v1/forecast`); Rust turns them into sentences, so the
// card never disagrees with the server about the level or the run-out date.
import type { Forecast } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";

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
export const shortDate = (iso: string): string => logic("forecast.short_date", { iso });

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export const daysBetween = (from: string, to: string): number => logic("forecast.days_between", { from, to });
/** Everything the forecast card shows. */
export const forecastView = (f: Forecast): ForecastView => logic("forecast.forecast_view", { f });
