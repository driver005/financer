// The wording of the "safe to spend today" card lives in Rust (crates/logic, safe_to_spend.rs). The
// numbers all come from the server; this only asks Rust to turn them into rows and sentences.
import type { SafeToSpend } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";

export type BreakdownRow = {
  id: string;
  label: string;
  /** Signed as it enters the sum: income is positive, everything taken off is negative. */
  cents: number;
  hint: string;
};

export const breakdownRows = (s: SafeToSpend): BreakdownRow[] => logic("safe_to_spend.breakdown_rows", { s });

/** `14 days left in this period` / `the last day of this period`. */
export const daysLeftText = (daysLeft: number): string => logic("safe_to_spend.days_left_text", { days_left: daysLeft });

export type PaceInfo = { tone: "good" | "warn" | "muted"; title: string; detail: string };

export const paceInfo = (s: SafeToSpend): PaceInfo => logic("safe_to_spend.pace_info", { s });

/** The one-sentence summary under the big number. */
export const headlineHint = (s: SafeToSpend): string => logic("safe_to_spend.headline_hint", { s });
