/** Pure savings-goal helpers (client-safe, unit-tested). */

export type GoalFundsInput = {
  goalId: string;
  goalName: string;
  /** Savings/destination account linked to the goal (optional). */
  goalAccountId: string | null;
  saved: number;
  /** Positive = deposit, negative = withdrawal. */
  amount: number;
  /** Source account for a deposit, destination account for a withdrawal. */
  accountId: string | null;
  date: string;
};

export type GoalTransfer = {
  account_id: string;
  to_account_id: string;
  amount: number;
  description: string;
  notes: string;
  occurred_at: string;
};

export type GoalFundsPlan = {
  direction: "deposit" | "withdraw";
  /** Amount actually moved (withdrawals are capped at what is saved). */
  moved: number;
  newSaved: number;
  transfer: GoalTransfer | null;
};

export const goalMarker = (goalId: string) => `[goal:${goalId}]`;

export function goalTransferDescription(direction: "deposit" | "withdraw", name: string): string {
  return `${direction === "deposit" ? "Setor target" : "Tarik target"} ${name}`.trim();
}

/** Decide how a deposit/withdrawal on a goal moves money. Never produces an expense. */
export function planGoalFunds(i: GoalFundsInput): GoalFundsPlan {
  if (!Number.isFinite(i.amount) || i.amount === 0) throw new Error("Nominal harus diisi");
  const saved = Math.max(0, Number(i.saved) || 0);
  const direction = i.amount > 0 ? "deposit" : "withdraw";
  const moved = direction === "deposit" ? i.amount : Math.min(-i.amount, saved);
  if (moved <= 0) throw new Error("Dana target masih kosong");
  const newSaved = direction === "deposit" ? saved + moved : saved - moved;
  let transfer: GoalTransfer | null = null;
  if (i.goalAccountId && i.accountId && i.goalAccountId !== i.accountId) {
    const [from, to] =
      direction === "deposit" ? [i.accountId, i.goalAccountId] : [i.goalAccountId, i.accountId];
    transfer = {
      account_id: from,
      to_account_id: to,
      amount: moved,
      description: goalTransferDescription(direction, i.goalName),
      notes: goalMarker(i.goalId),
      occurred_at: i.date,
    };
  }
  return { direction, moved, newSaved, transfer };
}

// ---------------------------------------------------------------------------
// Projection

export type GoalStatus = "done" | "overdue" | "on_track" | "behind" | "no_deadline";

export type GoalProjectionInput = {
  target: number;
  saved: number;
  /** YYYY-MM-DD (optional). */
  deadline?: string | null | undefined;
  /** YYYY-MM-DD, the "today" reference (Asia/Jakarta in the app). */
  today: string;
  /** Goal creation date or ISO timestamp (optional). */
  createdAt?: string | null | undefined;
};

export type GoalProjection = {
  remaining: number;
  /** Days until the deadline (negative = past); null without deadline. */
  daysLeft: number | null;
  /** Whole calendar months until the deadline, min 1 when not past; null without deadline. */
  monthsLeft: number | null;
  /** Rupiah per month needed to hit the deadline (ceil); null without deadline/when done/overdue. */
  monthlyNeeded: number | null;
  weeklyNeeded: number | null;
  status: GoalStatus;
  /** Linear expected savings by today (createdAt → deadline); null when unknown. */
  expectedByNow: number | null;
  /** Estimated completion month (YYYY-MM) at the average pace since createdAt; null if no progress. */
  eta: string | null;
};

const DAY_MS = 86_400_000;
const AVG_MONTH_DAYS = 30.4375;

function isoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d + "T00:00:00Z")) ? d : null;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY_MS);
}

/** Whole calendar months from a to b (a <= b), e.g. 2026-10-04 → 2026-12-03 = 1. */
function wholeMonths(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number) as [number, number, number];
  const [by, bm, bd] = b.split("-").map(Number) as [number, number, number];
  let m = (by - ay) * 12 + (bm - am);
  if (bd < ad) {
    // Compare against a's day clamped to b's month length (Jan 31 → Feb 28 counts as 1 month).
    const dim = new Date(Date.UTC(by, bm, 0)).getUTCDate();
    if (bd < Math.min(ad, dim)) m -= 1;
  }
  return Math.max(0, m);
}

function addMonthsKeepDay(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dim = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const first = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 8);
  return first + String(Math.min(d, dim)).padStart(2, "0");
}

function addMonthsYm(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/** Pure savings projection for a goal card. */
export function projectGoal(i: GoalProjectionInput): GoalProjection {
  const target = Math.max(0, Number(i.target) || 0);
  const saved = Math.max(0, Number(i.saved) || 0);
  const remaining = Math.max(0, target - saved);
  const today = isoDate(i.today) ?? "1970-01-01";
  const deadline = isoDate(i.deadline);
  const created = isoDate(i.createdAt);
  const elapsed = created ? Math.max(0, daysBetween(created, today)) : null;

  let eta: string | null = null;
  if (remaining > 0 && saved > 0 && elapsed !== null) {
    // At least one month of history so an opening balance doesn't look like a huge pace.
    const whole = wholeMonths(created!, today);
    const rest = daysBetween(addMonthsKeepDay(created!, whole), today);
    const pace = saved / Math.max(1, whole + rest / AVG_MONTH_DAYS);
    const months = Math.ceil(remaining / pace);
    if (Number.isFinite(months) && months <= 1200) eta = addMonthsYm(today, months);
  }

  const daysLeft = deadline ? daysBetween(today, deadline) : null;
  const monthsLeft =
    deadline && daysLeft !== null
      ? daysLeft < 0
        ? 0
        : Math.max(1, wholeMonths(today, deadline))
      : null;

  let expectedByNow: number | null = null;
  if (deadline && created) {
    const total = daysBetween(created, deadline);
    const frac = total <= 0 ? 1 : Math.min(1, Math.max(0, (elapsed ?? 0) / total));
    expectedByNow = Math.round(target * frac);
  }

  const active = remaining > 0 && daysLeft !== null && daysLeft >= 0;
  const monthlyNeeded = active && monthsLeft ? Math.ceil(remaining / monthsLeft) : null;
  const weeklyNeeded = active
    ? Math.ceil(remaining / Math.max(1, Math.floor(daysLeft! / 7)))
    : null;

  let status: GoalStatus;
  if (remaining === 0) status = "done";
  else if (!deadline) status = "no_deadline";
  else if (daysLeft! < 0) status = "overdue";
  else if (expectedByNow === null) status = "on_track";
  else status = saved >= expectedByNow ? "on_track" : "behind";

  return {
    remaining,
    daysLeft,
    monthsLeft,
    monthlyNeeded,
    weeklyNeeded,
    status,
    expectedByNow,
    eta: status === "done" ? null : eta,
  };
}
