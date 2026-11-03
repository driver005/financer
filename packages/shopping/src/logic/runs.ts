// The history of reading runs: one line each, and the totals they add up to.

import type { JobView, Phase } from "../api/types";

export const PHASE_WORDS: Record<Phase, string> = {
  queued: "Waiting",
  running: "Reading",
  done: "Done",
  failed: "Failed",
  cancelled: "Stopped",
};

export type RunTone = "neutral" | "info" | "success" | "danger" | "warning";

export function phaseTone(p: Phase): RunTone {
  return p === "done" ? "success" : p === "failed" ? "danger" : p === "cancelled" ? "warning" : p === "running" ? "info" : "neutral";
}

export const isActive = (j: JobView) => j.progress.phase === "running" || j.progress.phase === "queued";

/** Newest first; a run still going comes before the finished ones. */
export function orderRuns(jobs: JobView[]): JobView[] {
  return [...jobs].sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || b.started_at - a.started_at);
}

/** What a run found, in words: "22 pages, 4 new products, 7 price changes, 2 pages failed". */
export function runSummary(j: JobView): string {
  const r = j.report;
  if (!r) {
    const p = j.progress;
    return p.total > 0 ? `${p.done} of ${p.total} pages · ${p.products} products` : p.message || "Starting";
  }
  const parts = [`${r.pages} ${r.pages === 1 ? "page" : "pages"}`];
  if (r.new_products) parts.push(`${r.new_products} new ${r.new_products === 1 ? "product" : "products"}`);
  if (r.price_changes) parts.push(`${r.price_changes} price ${r.price_changes === 1 ? "change" : "changes"}`);
  if (r.failed) parts.push(`${r.failed} ${r.failed === 1 ? "page" : "pages"} failed`);
  return parts.join(", ");
}

/** The shops that had trouble, with the last thing each one said. */
export function runProblems(j: JobView): { shop: string; text: string }[] {
  return Object.entries(j.report?.sources ?? {})
    .filter(([, s]) => s.failed > 0 || s.last_error)
    .map(([shop, s]) => ({ shop, text: s.last_error ?? `${s.failed} of ${s.pages} pages failed` }));
}
