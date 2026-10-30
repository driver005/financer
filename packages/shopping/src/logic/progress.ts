// The progress notification of an index run. The planning here is pure; `native/progressNotifier`
// shows what it decides. A notification cannot show a real bar everywhere:
//
//  - Android with Notifee: a true determinate bar (and a foreground service that keeps the run alive).
//  - Otherwise (iOS, Expo Go, the web): a sticky text notification with a bar made of blocks.
//
// `ProgressModel.bar` is that text bar; `ProgressModel.percent` feeds the real one.

import type { JobView, Phase, ProgressState } from "../api/types";

export type ProgressModel = {
  title: string;
  body: string;
  percent: number;
  /** No page count yet: show a bar that only animates. */
  indeterminate: boolean;
  /** Still running: sticky, cannot be swiped away. */
  ongoing: boolean;
  /** `▰▰▰▱▱▱▱▱▱▱ 30 %` */
  bar: string;
  finished: boolean;
  phase: Phase;
};

const FULL = "▰";
const EMPTY = "▱";
const SEGMENTS = 10;

export function textBar(percent: number): string {
  const p = Math.min(100, Math.max(0, Math.round(percent)));
  const filled = Math.round((p / 100) * SEGMENTS);
  return `${FULL.repeat(filled)}${EMPTY.repeat(SEGMENTS - filled)} ${p} %`;
}

export function progressModel(query: string, s: ProgressState): ProgressModel {
  const finished = s.phase === "done" || s.phase === "failed" || s.phase === "cancelled";
  const base = { percent: s.percent, ongoing: !finished, bar: textBar(s.percent), finished, phase: s.phase };
  switch (s.phase) {
    case "done": {
      const n = s.products;
      return {
        ...base,
        title: "Search index ready",
        body: n === 0 ? `Nothing found for "${query}"` : `${n} ${n === 1 ? "product" : "products"} indexed for "${query}"`,
        indeterminate: false,
      };
    }
    case "failed":
      return { ...base, title: "Indexing failed", body: s.message || "No source could be read", indeterminate: false };
    case "cancelled":
      return { ...base, title: "Indexing stopped", body: `Stopped searching for "${query}"`, indeterminate: false };
    case "queued":
      return { ...base, title: "Preparing search", body: `"${query}"`, indeterminate: true };
    default:
      return {
        ...base,
        title: `Indexing "${query}"`,
        body: s.total > 0 ? `${s.message} · ${s.done}/${s.total} pages · ${s.products} products` : s.message,
        indeterminate: s.total === 0,
      };
  }
}

/**
 * Whether a new model is worth showing. Notifications that change many times a second get
 * throttled by the system and drain the battery, so: always show the first and the last, and in
 * between only when the percent moved and a second has passed.
 */
export function worthShowing(prev: ProgressModel | null, next: ProgressModel, lastShownMs: number, nowMs: number, minGapMs = 1000): boolean {
  if (!prev) return true;
  if (next.finished) return true;
  if (prev.phase !== next.phase) return true;
  if (nowMs - lastShownMs < minGapMs) return false;
  return prev.percent !== next.percent || prev.body !== next.body;
}

/** What shows a notification. Implementations live in `native/`. */
export interface ProgressSurface {
  show(model: ProgressModel): Promise<void>;
  /** Called once, with the final model; the notification stops being sticky. */
  finish(model: ProgressModel): Promise<void>;
}

export type DriverDeps = {
  poll: (jobId: string) => Promise<JobView>;
  surface: ProgressSurface;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
  /** Give up after this many failed polls in a row (the server went away). */
  maxFailures?: number;
};

export type DriverResult = { job: JobView | null; polls: number; shown: number };

/**
 * Follow a job until it ends, showing its progress. The loop is the only thing that runs while
 * the person has left the app (inside the Android foreground service, when there is one).
 */
export async function followJob(jobId: string, query: string, deps: DriverDeps): Promise<DriverResult> {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const pollMs = deps.pollMs ?? 500;
  const maxFailures = deps.maxFailures ?? 8;
  let prev: ProgressModel | null = null;
  let lastShown = 0;
  let polls = 0;
  let shown = 0;
  let failures = 0;
  let last: JobView | null = null;
  for (;;) {
    try {
      last = await deps.poll(jobId);
      failures = 0;
    } catch {
      failures += 1;
      if (failures >= maxFailures) {
        const model = progressModel(query, { phase: "failed", message: "Lost contact with the search", done: 0, total: 0, products: 0, failed: 0, percent: prev?.percent ?? 0 });
        await deps.surface.finish(model);
        return { job: last, polls, shown };
      }
      await sleep(pollMs);
      continue;
    }
    polls += 1;
    const model = progressModel(query, last.progress);
    if (model.finished) {
      await deps.surface.finish(model);
      return { job: last, polls, shown: shown + 1 };
    }
    if (worthShowing(prev, model, lastShown, now())) {
      await deps.surface.show(model);
      shown += 1;
      lastShown = now();
    }
    prev = model;
    await sleep(pollMs);
  }
}
