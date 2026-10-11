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
}): string {
  const { progress, streakDays, allowanceCents, spentTodayCents } = args;
  if (progress.transactions === 0) return "Hi, I'm Penny! Import your spending and we start your first streak.";
  if (allowanceCents === 0) return "Set a grocery limit and I'll turn it into a daily goal for you.";
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
}): Mood {
  if (args.allowanceCents > 0 && args.spentTodayCents > args.allowanceCents) return "worried";
  if (args.celebrating || args.streakDays >= 7) return "cheer";
  return "happy";
}
