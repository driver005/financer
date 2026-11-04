// The progress notification of an index run. The planning is in Rust (crates/logic,
// shop_progress.rs); the polling loop is here and `native/progressNotifier` shows what it decides. A notification cannot show a real bar everywhere:
//
//  - Android with Notifee: a true determinate bar (and a foreground service that keeps the run alive).
//  - Otherwise (iOS, Expo Go, the web): a sticky text notification with a bar made of blocks.
//
// `ProgressModel.bar` is that text bar; `ProgressModel.percent` feeds the real one.

import { logic } from "../../../wire/src/logic";
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

/** `▰▰▰▱▱▱▱▱▱▱ 30 %` */
export const textBar = (percent: number): string => logic("shop_progress.text_bar", { percent });

export const progressModel = (query: string, s: ProgressState): ProgressModel => logic("shop_progress.progress_model", { query, s });

/**
 * Whether a new model is worth showing. Notifications that change many times a second get
 * throttled by the system and drain the battery, so: always show the first and the last, and in
 * between only when the percent moved and a second has passed.
 */
export const worthShowing = (prev: ProgressModel | null, next: ProgressModel, lastShownMs: number, nowMs: number, minGapMs = 1000): boolean =>
  logic("shop_progress.worth_showing", { prev, next, last_shown_ms: lastShownMs, now_ms: nowMs, min_gap_ms: minGapMs });

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
      // the rules decide when the server is given up on; the loop only waits
      const f: { failures: number; finish: ProgressModel | null } = logic("shop_progress.follow_failed", { query, failures, max_failures: maxFailures, prev });
      failures = f.failures;
      if (f.finish) {
        await deps.surface.finish(f.finish);
        return { job: last, polls, shown };
      }
      await sleep(pollMs);
      continue;
    }
    polls += 1;
    const step: { model: ProgressModel; action: "finish" | "show" | "skip" } = logic("shop_progress.follow_ok", {
      query,
      progress: last.progress,
      prev,
      last_shown_ms: lastShown,
      now_ms: now(),
    });
    if (step.action === "finish") {
      await deps.surface.finish(step.model);
      return { job: last, polls, shown: shown + 1 };
    }
    if (step.action === "show") {
      await deps.surface.show(step.model);
      shown += 1;
      lastShown = now();
    }
    prev = step.model;
    await sleep(pollMs);
  }
}
