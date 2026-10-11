/**
 * Wording for the "safe to spend today" card and its explainer sheet. The numbers all come from
 * the server (`GET /v1/budget/safe-to-spend`); this only turns them into rows and sentences, so
 * what the sheet shows always adds up to the big number.
 */
import type { SafeToSpend } from "./api/client";
import { formatCents } from "./format";

export type BreakdownRow = {
  id: string;
  label: string;
  /** Signed as it enters the sum: income is positive, everything taken off is negative. */
  cents: number;
  hint: string;
};

export function breakdownRows(s: SafeToSpend): BreakdownRow[] {
  return [
    {
      id: "income",
      label: "Income this period",
      cents: s.income_cents,
      hint: s.income_detected
        ? `${formatCents(s.income_received_cents)} arrived, ${formatCents(s.income_upcoming_cents)} still expected (from recurring income)`
        : "No recurring income found in your bookings yet",
    },
    {
      id: "spent",
      label: "Spent so far",
      cents: -s.spent_so_far_cents,
      hint: "Everything booked in this period, including fixed costs already paid",
    },
    {
      id: "fixed",
      label: "Fixed costs still to come",
      cents: -s.fixed_costs_due_cents,
      hint: "Recurring payments (rent, subscriptions) due before the period ends",
    },
    {
      id: "envelopes",
      label: "Planned in envelopes",
      cents: -s.envelope_headroom_cents,
      hint: "Budget limits you have not used up yet; kept aside for those categories",
    },
  ];
}

/** `14 days left in this period` / `last day of this period`. */
export function daysLeftText(daysLeft: number): string {
  if (daysLeft <= 1) return "the last day of this period";
  return `${daysLeft} days left in this period`;
}

export type PaceInfo = { tone: "good" | "warn" | "muted"; title: string; detail: string };

export function paceInfo(s: SafeToSpend): PaceInfo {
  if (s.pace === "unknown") {
    return {
      tone: "muted",
      title: "Pace unknown",
      detail: "Needs recurring income to compare against. Import a few months of bookings with your salary.",
    };
  }
  const detail = `You have spent ${formatCents(s.discretionary_spent_cents)} on everyday things; a straight-line plan would allow ${formatCents(s.pace_target_cents)} by today.`;
  return s.pace === "over_pace"
    ? { tone: "warn", title: "Over pace", detail }
    : { tone: "good", title: "On track", detail };
}

/** The one-sentence summary under the big number. */
export function headlineHint(s: SafeToSpend): string {
  if (!s.income_detected) return "No recurring income found yet, so there is nothing to plan with.";
  if (s.available_cents < 0) return `This period is over budget by ${formatCents(-s.available_cents)}.`;
  return `${formatCents(s.available_cents)} free for ${daysLeftText(s.days_left)}.`;
}
