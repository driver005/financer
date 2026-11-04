// The history of reading runs: one line each, and the totals they add up to. The rules are in Rust
// (crates/logic, shop_misc.rs).

import { logic } from "../../../wire/src/logic";
import type { JobView, Phase } from "../api/types";

export const PHASE_WORDS: Record<Phase, string> = {
  queued: "Waiting",
  running: "Reading",
  done: "Done",
  failed: "Failed",
  cancelled: "Stopped",
};

export type RunTone = "neutral" | "info" | "success" | "danger" | "warning";

export const phaseTone = (p: Phase): RunTone => logic("shop_misc.phase_tone", { p });

export const isActive = (j: JobView): boolean => logic("shop_misc.is_active", { j });

/** Newest first; a run still going comes before the finished ones. */
export const orderRuns = (jobs: JobView[]): JobView[] => logic("shop_misc.order_runs", { jobs });

/** What a run found, in words: "22 pages, 4 new products, 7 price changes, 2 pages failed". */
export const runSummary = (j: JobView): string => logic("shop_misc.run_summary", { j });

/** The shops that had trouble, with the last thing each one said. */
export const runProblems = (j: JobView): { shop: string; text: string }[] => logic("shop_misc.run_problems", { j });
