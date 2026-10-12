/**
 * Writes the setup's answers to the backend through the existing API (payday and "how to learn
 * what you buy" are settings, the grocery limit is the groceries envelope). Only answered
 * questions are written, and the other envelopes are kept as they are.
 */

import type { Api } from "./api/client";
import { planApply, type Draft } from "./onboarding";

export type ApplyApi = Pick<Api, "envelopes" | "saveEnvelopes" | "saveSettings">;

export type ApplyResult = { ok: true; wrote: string[] } | { ok: false; error: string };

export async function applyDraft(api: ApplyApi, draft: Draft, today: string): Promise<ApplyResult> {
  try {
    const wrote: string[] = [];
    const settings: { payday?: number; habit_mode?: string } = {};
    // payday first: the grocery limit is spread over the days of the period it starts
    if (draft.payday !== undefined) settings.payday = draft.payday;
    if (draft.habitMode !== undefined) settings.habit_mode = draft.habitMode;
    if (Object.keys(settings).length) {
      await api.saveSettings(settings);
      wrote.push(...Object.keys(settings));
    }
    const plan = planApply(draft, today, []);
    if (plan.envelopes !== null) {
      const existing = await api.envelopes();
      const merged = planApply(draft, today, existing).envelopes!;
      await api.saveEnvelopes(merged);
      wrote.push("groceries limit");
    }
    return { ok: true, wrote };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save to the backend" };
  }
}
