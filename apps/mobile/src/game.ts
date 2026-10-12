/**
 * The playful layer: streaks, daily goals ("quests"), XP and levels. Everything is derived
 * from your real data (transactions, limits, usual items), nothing is invented or stored
 * separately, so it can never drift from the numbers on the other screens.
 */

import { budgetPeriod, daysInMonth, periodDays } from "./period";

export { daysInMonth };

export type Tx = { booking_date: string; amount_cents: number; category?: string | null };

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** What you may spend per day in a month with this limit (rounded down to whole cents). */
export function dailyAllowance(limitCents: number, year: number, month: number): number {
  return Math.floor(limitCents / daysInMonth(year, month));
}

/** The same for a budget period of `days` days (a payday period is not a calendar month). */
export function dailyAllowanceForDays(limitCents: number, days: number): number {
  return Math.floor(limitCents / Math.max(1, days));
}

/** What you may spend per day on `date`, in the budget period (from `payday`) that contains it. */
export function dailyAllowanceOn(limitCents: number, date: string, payday = 1): number {
  return dailyAllowanceForDays(limitCents, periodDays(budgetPeriod(date, payday)));
}

/** Cents spent (a positive number) in one category on one day; refunds reduce it. */
export function spentOn(txs: Tx[], date: string, category: string): number {
  let sum = 0;
  for (const t of txs) {
    if (t.booking_date === date && t.category === category) sum -= t.amount_cents;
  }
  return Math.max(0, sum);
}

/**
 * Days in a row, ending today, on which you stayed within the daily allowance for a
 * category. The allowance of a day is the limit over the days of its budget period (a calendar
 * month unless a payday is set). A day over the allowance ends the streak. Days before your
 * first transaction are not counted (there is nothing to judge them by).
 */
export function streak(txs: Tx[], limitCents: number, today: string, category = "groceries", payday = 1): number {
  if (limitCents <= 0 || txs.length === 0) return 0;
  const first = Math.min(...txs.map((t) => toUtc(t.booking_date)));
  let count = 0;
  for (let ms = toUtc(today), i = 0; ms >= first && i < 366; ms -= DAY_MS, i++) {
    const day = toIso(ms);
    if (spentOn(txs, day, category) > dailyAllowanceOn(limitCents, day, payday)) break;
    count++;
  }
  return count;
}

export type Progress = {
  transactions: number;
  limits: number;
  usualItems: number;
  prices: number;
  receipts: number;
};

export type Quest = {
  id: string;
  title: string;
  hint: string;
  route: "/spending" | "/budget" | "/basket" | "/prices" | "/receipts";
  done: boolean;
};

export const QUEST_XP = 10;
export const STREAK_XP = 5;
export const LEVEL_XP = 50;

export function quests(p: Progress): Quest[] {
  return [
    { id: "import", title: "Import your spending", hint: "Sync with Sparkasse or import a CSV", route: "/spending", done: p.transactions > 0 },
    { id: "limit", title: "Set a monthly limit", hint: "Give groceries a budget", route: "/budget", done: p.limits > 0 },
    { id: "items", title: "Add your usual items", hint: "So we can find them cheaper", route: "/basket", done: p.usualItems > 0 },
    { id: "prices", title: "Fetch fresh prices", hint: "Compare Lidl, Aldi, Kaufland, Rewe", route: "/prices", done: p.prices > 0 },
    { id: "receipt", title: "Add a receipt", hint: "Learn what you really buy", route: "/receipts", done: p.receipts > 0 },
  ];
}

export function xp(done: number, streakDays: number): number {
  return done * QUEST_XP + streakDays * STREAK_XP;
}

const TITLES = ["Penny Pincher", "Budget Bee", "Savings Ninja", "Coin Wizard", "Money Master"];

export function level(totalXp: number): { level: number; title: string; into: number; size: number } {
  const lvl = Math.floor(totalXp / LEVEL_XP) + 1;
  return { level: lvl, title: TITLES[Math.min(lvl, TITLES.length) - 1], into: totalXp % LEVEL_XP, size: LEVEL_XP };
}

/** What the mascot says, picked from the real situation. */
export function coachMessage(args: {
  progress: Progress;
  streakDays: number;
  allowanceCents: number;
  spentTodayCents: number;
  /** A streak freeze covered today (see `streakState`). */
  freezeUsedToday?: boolean;
}): string {
  const { progress, streakDays, allowanceCents, spentTodayCents } = args;
  if (progress.transactions === 0) return "Hi, I'm Penny! Import your spending and we start your first streak.";
  if (allowanceCents === 0) return "Set a grocery limit and I'll turn it into a daily goal for you.";
  if (args.freezeUsedToday) return `A streak freeze covered today, so your ${streakDays}-day streak lives on!`;
  if (spentTodayCents > allowanceCents) return "Over today's goal, but no stress. Tomorrow is a fresh start!";
  if (streakDays >= 7) return `${streakDays} days in a row! You're on fire. Keep it up!`;
  if (streakDays >= 3) return `${streakDays}-day streak. Nice, don't break it now!`;
  if (spentTodayCents === 0) return "Nothing spent on groceries yet today. Smart shopping starts with a plan!";
  return "Still inside today's goal. Keep going!";
}

export type Mood = "happy" | "cheer" | "worried";

/** The mascot's mood: worried over today's goal, cheering on a long streak or a fresh win. */
export function moodFor(args: {
  streakDays: number;
  allowanceCents: number;
  spentTodayCents: number;
  celebrating?: boolean;
  /** A streak freeze covered today: over the goal, but the streak is safe. */
  freezeUsedToday?: boolean;
}): Mood {
  if (args.freezeUsedToday) return args.celebrating ? "cheer" : "happy";
  if (args.allowanceCents > 0 && args.spentTodayCents > args.allowanceCents) return "worried";
  if (args.celebrating || args.streakDays >= 7) return "cheer";
  return "happy";
}

/* ------------------------------------------------------------------------------------------
 * Rewards: streak freezes, badges and personal bests.
 *
 * Nothing here is stored. Every function replays the transactions day by day (and uses the
 * budget limits you have now), so the same data always gives the same freezes, badges and
 * bests, and deleting or re-importing bookings changes them with the data. The replay covers
 * the last REPLAY_DAYS days, which bounds the work and keeps the result a pure function of its
 * input.
 * -------------------------------------------------------------------------------------------- */

/** A freeze is earned with every 7th day of a streak ... */
export const FREEZE_EVERY = 7;
/** ... and you can hold at most this many. */
export const MAX_FREEZES = 2;
/** How far back the replay looks (about three years). */
export const REPLAY_DAYS = 1100;

function addDays(iso: string, days: number): string {
  return toIso(toUtc(iso) + days * DAY_MS);
}

/** The Monday of the week (ISO weeks) that contains `iso`. */
export function weekStart(iso: string): string {
  const weekday = (new Date(toUtc(iso)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(iso, -weekday);
}

/** Net cents spent per day in one category (refunds reduce it, never below zero). */
function spendByDay(txs: Tx[], category: string): Map<string, number> {
  const sums = new Map<string, number>();
  for (const t of txs) {
    if (t.category === category) sums.set(t.booking_date, (sums.get(t.booking_date) ?? 0) - t.amount_cents);
  }
  for (const [day, cents] of sums) sums.set(day, Math.max(0, cents));
  return sums;
}

function firstBookingDay(txs: Tx[]): string | null {
  let first: string | null = null;
  for (const t of txs) if (first === null || t.booking_date < first) first = t.booking_date;
  return first;
}

export type StreakState = {
  /** The running streak, ending today; days bridged by a freeze keep it alive but are not counted. */
  days: number;
  /** The longest streak in the replayed history. */
  best: number;
  /** The day the longest streak ended on (the latest one if two are equally long). */
  bestEndedOn: string | null;
  /** Freezes in stock right now (0 to MAX_FREEZES). */
  freezes: number;
  /** Freezes earned so far, not counting those lost because you already held MAX_FREEZES. */
  earned: number;
  /** The days a freeze was used on automatically. */
  usedOn: string[];
  /** A freeze was used on `today`. */
  frozenToday: boolean;
  /** The first day the running streak reached 7 and 30 days (for the badge dates). */
  reached: { 7: string | null; 30: string | null };
};

function noStreak(): StreakState {
  return { days: 0, best: 0, bestEndedOn: null, freezes: 0, earned: 0, usedOn: [], frozenToday: false, reached: { 7: null, 30: null } };
}

/**
 * The streak with freezes, replayed from your first booking (at most REPLAY_DAYS back) to today.
 *
 * For every day, in order:
 * - within the day's allowance: the streak grows by one; every 7th day of a streak earns a
 *   freeze (at most MAX_FREEZES in stock, an extra one is lost);
 * - over the allowance and a freeze in stock: the freeze is used up automatically, the streak
 *   stays as it was (the day itself does not count);
 * - over the allowance and no freeze: the streak starts again from zero.
 *
 * Without any freeze this is the same number as `streak()` (apart from its 366-day cap).
 */
export function streakState(txs: Tx[], limitCents: number, today: string, category = "groceries", payday = 1): StreakState {
  const s = noStreak();
  const first = firstBookingDay(txs);
  if (limitCents <= 0 || first === null) return s;
  const earliest = addDays(today, -REPLAY_DAYS);
  const spend = spendByDay(txs, category);
  for (let day = first > earliest ? first : earliest; day <= today; day = addDays(day, 1)) {
    if ((spend.get(day) ?? 0) <= dailyAllowanceOn(limitCents, day, payday)) {
      s.days++;
      if (s.days >= s.best) {
        s.best = s.days;
        s.bestEndedOn = day;
      }
      if (s.days === 7 && s.reached[7] === null) s.reached[7] = day;
      if (s.days === 30 && s.reached[30] === null) s.reached[30] = day;
      if (s.days % FREEZE_EVERY === 0 && s.freezes < MAX_FREEZES) {
        s.freezes++;
        s.earned++;
      }
    } else if (s.freezes > 0) {
      s.freezes--;
      s.usedOn.push(day);
    } else {
      s.days = 0;
    }
  }
  s.frozenToday = s.usedOn[s.usedOn.length - 1] === today;
  return s;
}

/* ---- weeks and personal bests ---- */

export type WeekTotal = { start: string; end: string; spentCents: number };

/**
 * Grocery spending of every complete week (Monday to Sunday, ending before `today`) that lies
 * inside your data: it starts on or after your first booking and has at least one grocery booking.
 */
export function completeWeeks(txs: Tx[], today: string, category = "groceries"): WeekTotal[] {
  const first = firstBookingDay(txs);
  if (first === null) return [];
  const totals = new Map<string, number>();
  for (const t of txs) {
    if (t.category !== category) continue;
    const key = weekStart(t.booking_date);
    totals.set(key, (totals.get(key) ?? 0) - t.amount_cents);
  }
  const weeks: WeekTotal[] = [];
  for (const [start, cents] of totals) {
    const end = addDays(start, 6);
    if (start >= first && end < today) weeks.push({ start, end, spentCents: Math.max(0, cents) });
  }
  return weeks.sort((a, b) => (a.start < b.start ? -1 : 1));
}

export type PersonalBests = {
  longestStreak: number;
  longestStreakEndedOn: string | null;
  /** The complete week with the lowest grocery spending (the latest one if tied). */
  bestWeek: WeekTotal | null;
  /** Grocery spending in the running week so far. */
  thisWeekCents: number;
};

export function personalBests(txs: Tx[], streak: StreakState, today: string, category = "groceries"): PersonalBests {
  let bestWeek: WeekTotal | null = null;
  for (const w of completeWeeks(txs, today, category)) {
    if (bestWeek === null || w.spentCents <= bestWeek.spentCents) bestWeek = w;
  }
  const monday = weekStart(today);
  let thisWeek = 0;
  for (const t of txs) {
    if (t.category === category && t.booking_date >= monday && t.booking_date <= today) thisWeek -= t.amount_cents;
  }
  return {
    longestStreak: streak.best,
    longestStreakEndedOn: streak.bestEndedOn,
    bestWeek,
    thisWeekCents: Math.max(0, thisWeek),
  };
}

/* ---- badges ---- */

export type Badge = {
  id: string;
  title: string;
  /** The rule, in plain words (shown on the Trophies screen). */
  rule: string;
  icon: string;
  earned: boolean;
  /** The day it was first earned; `null` when it is not tied to a day or not earned. */
  earnedOn: string | null;
};

export type BadgeInput = {
  txs: Tx[];
  /** The groceries limit per budget period in cents (0 = none). */
  groceryLimit: number;
  /** Net amount to put aside per budget period in cents (0 = no goal). */
  savingsGoal: number;
  today: string;
  payday: number;
  progress: Progress;
  streak: StreakState;
};

type BadgeDef = Omit<Badge, "earned" | "earnedOn">;

const BADGE_DEFS: BadgeDef[] = [
  { id: "first-week", title: "First week", icon: "🔥", rule: "Stay within the daily grocery goal 7 days in a row." },
  { id: "streak-30", title: "30-day streak", icon: "🏆", rule: "Stay within the daily grocery goal 30 days in a row." },
  { id: "streak-saved", title: "Streak saved", icon: "❄️", rule: "A streak freeze kept your streak alive on a day you went over." },
  {
    id: "week-under-budget",
    title: "Week under budget",
    icon: "📅",
    rule: "A full week (Monday to Sunday) that starts after your first booking, with groceries at or below 7 daily goals.",
  },
  {
    id: "month-under-budget",
    title: "Period under budget",
    icon: "🌟",
    rule: "A whole budget period (payday to payday) that starts after your first booking, with groceries within the limit.",
  },
  {
    id: "no-spend-day",
    title: "No-spend day",
    icon: "🧘",
    rule: "A day between your first and your latest booking with no money going out (transfers to savings are not spending).",
  },
  {
    id: "savings-goal",
    title: "Savings goal reached",
    icon: "🐷",
    rule: "Put aside at least your savings goal (category Savings) within one budget period.",
  },
  { id: "quest-master", title: "Quest master", icon: "🎯", rule: "Complete all the quests on the Today screen." },
];

/** The ids of all badges, in the order they are shown. */
export const BADGE_IDS = BADGE_DEFS.map((b) => b.id);

/** The end of the first complete week inside the data whose grocery spending fits 7 daily goals. */
function firstWeekUnderBudget(i: BadgeInput): string | null {
  const first = firstBookingDay(i.txs);
  if (first === null || i.groceryLimit <= 0) return null;
  const active = new Set(i.txs.map((t) => t.booking_date));
  const spend = spendByDay(i.txs, "groceries");
  for (let start = weekStart(first); addDays(start, 6) < i.today; start = addDays(start, 7)) {
    if (start < first) continue;
    let spent = 0;
    let allowed = 0;
    let busy = false;
    for (let k = 0; k < 7; k++) {
      const day = addDays(start, k);
      spent += spend.get(day) ?? 0;
      allowed += dailyAllowanceOn(i.groceryLimit, day, i.payday);
      busy = busy || active.has(day);
    }
    if (busy && spent <= allowed) return addDays(start, 6);
  }
  return null;
}

/** The end of the first complete budget period inside the data with groceries within the limit. */
function firstPeriodUnderBudget(i: BadgeInput): string | null {
  const first = firstBookingDay(i.txs);
  if (first === null || i.groceryLimit <= 0) return null;
  const grocery = i.txs.filter((t) => t.category === "groceries");
  let p = budgetPeriod(first, i.payday);
  for (let n = 0; p.end < i.today && n < 400; n++, p = budgetPeriod(addDays(p.end, 1), i.payday)) {
    if (p.start < first) continue;
    if (!i.txs.some((t) => t.booking_date >= p.start && t.booking_date <= p.end)) continue;
    let spent = 0;
    for (const t of grocery) if (t.booking_date >= p.start && t.booking_date <= p.end) spent -= t.amount_cents;
    if (spent <= i.groceryLimit) return p.end;
  }
  return null;
}

/** The first day with no money going out, between the first and the latest booking, before today. */
function firstNoSpendDay(i: BadgeInput): string | null {
  const out = new Set<string>();
  let first: string | null = null;
  let last: string | null = null;
  for (const t of i.txs) {
    if (first === null || t.booking_date < first) first = t.booking_date;
    if (last === null || t.booking_date > last) last = t.booking_date;
    if (t.amount_cents < 0 && t.category !== "savings") out.add(t.booking_date);
  }
  if (first === null || last === null) return null;
  const earliest = addDays(i.today, -REPLAY_DAYS);
  for (let day = first > earliest ? first : earliest; day <= last && day < i.today; day = addDays(day, 1)) {
    if (!out.has(day)) return day;
  }
  return null;
}

/** The earliest day on which the money put aside in a budget period reached the goal. */
function firstSavingsGoalDay(i: BadgeInput): string | null {
  if (i.savingsGoal <= 0) return null;
  const saved = i.txs.filter((t) => t.category === "savings").sort((a, b) => (a.booking_date < b.booking_date ? -1 : a.booking_date > b.booking_date ? 1 : 0));
  const totals = new Map<string, number>();
  let earliest: string | null = null;
  for (const t of saved) {
    const key = budgetPeriod(t.booking_date, i.payday).start;
    const total = (totals.get(key) ?? 0) - t.amount_cents;
    totals.set(key, total);
    if (total >= i.savingsGoal && (earliest === null || t.booking_date < earliest)) earliest = t.booking_date;
  }
  return earliest;
}

/** Net cents put aside (category savings) in the budget period that contains `today`, up to today. */
export function savedThisPeriod(txs: Tx[], today: string, payday = 1): number {
  const period = budgetPeriod(today, payday);
  let saved = 0;
  for (const t of txs) {
    if (t.category === "savings" && t.booking_date >= period.start && t.booking_date <= today) saved -= t.amount_cents;
  }
  return Math.max(0, saved);
}

/** Every badge, in display order, with whether (and on which day) it was earned. */
export function badges(i: BadgeInput): Badge[] {
  const earnedOn: Record<string, string | null> = {
    "first-week": i.streak.reached[7],
    "streak-30": i.streak.reached[30],
    "streak-saved": i.streak.usedOn[0] ?? null,
    "week-under-budget": firstWeekUnderBudget(i),
    "month-under-budget": firstPeriodUnderBudget(i),
    "no-spend-day": firstNoSpendDay(i),
    "savings-goal": firstSavingsGoalDay(i),
  };
  const allQuests = quests(i.progress).every((q) => q.done);
  return BADGE_DEFS.map((def) => {
    const on = earnedOn[def.id] ?? null;
    const earned = def.id === "quest-master" ? allQuests : on !== null;
    return { ...def, earned, earnedOn: earned ? on : null };
  });
}

/**
 * The badges to celebrate now: earned, not in the persisted `seen` list and not celebrated
 * earlier in this session (`celebrated` is a module-level set, like the quests' guard).
 */
export function freshBadges(all: Badge[], seen: readonly string[], celebrated: ReadonlySet<string>): Badge[] {
  return all.filter((b) => b.earned && !seen.includes(b.id) && !celebrated.has(b.id));
}

/* ---- everything together ---- */

export type Rewards = {
  streak: StreakState;
  badges: Badge[];
  bests: PersonalBests;
};

export type RewardsInput = Omit<BadgeInput, "streak">;

export function computeRewards(i: RewardsInput): Rewards {
  const streak = streakState(i.txs, i.groceryLimit, i.today, "groceries", i.payday);
  return { streak, badges: badges({ ...i, streak }), bests: personalBests(i.txs, streak, i.today) };
}

/** What the mascot says on the Trophies screen. */
export function trophyMessage(r: Rewards): string {
  const earned = r.badges.filter((b) => b.earned).length;
  if (r.streak.frozenToday) return `A streak freeze saved your ${r.streak.days}-day streak today. Nice save!`;
  if (earned === r.badges.length) return "Every trophy collected. You're a legend!";
  if (earned === 0) return "Your first trophy is close. A week inside the daily goal gets you one!";
  if (r.streak.freezes === MAX_FREEZES) return "Two streak freezes in stock. Your streak is well protected!";
  return `${earned} of ${r.badges.length} trophies. Keep collecting!`;
}

/** Cheering when the collection is complete or just grew, otherwise happy. */
export function trophyMood(r: Rewards, justEarned: boolean): Mood {
  return justEarned || r.badges.every((b) => b.earned) ? "cheer" : "happy";
}
