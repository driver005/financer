/**
 * The playful layer: streaks, daily goals ("quests"), XP and levels. The rules live in Rust
 * (crates/logic, game.rs); everything is derived from your real data (transactions, limits, usual
 * items), nothing is invented or stored separately, so it can never drift from the other screens.
 * This file holds the shapes the screens use and the typed entries into that code.
 */

import { logic } from "../../../packages/wire/src/logic";
import { daysInMonth } from "./period";

export { daysInMonth };

export type Tx = { booking_date: string; amount_cents: number; category?: string | null };

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

/** The numbers below also live in Rust; a test compares them (`game.constants`). */
export const QUEST_XP = 10;
export const STREAK_XP = 5;
export const LEVEL_XP = 50;
/** A freeze is earned with every 7th day of a streak ... */
export const FREEZE_EVERY = 7;
/** ... and you can hold at most this many. */
export const MAX_FREEZES = 2;
/** How far back the replay looks (about three years). */
export const REPLAY_DAYS = 1100;

export type Mood = "happy" | "cheer" | "worried";

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

export type WeekTotal = { start: string; end: string; spentCents: number };

export type PersonalBests = {
  longestStreak: number;
  longestStreakEndedOn: string | null;
  /** The complete week with the lowest grocery spending (the latest one if tied). */
  bestWeek: WeekTotal | null;
  /** Grocery spending in the running week so far. */
  thisWeekCents: number;
};

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

export type Rewards = {
  streak: StreakState;
  badges: Badge[];
  bests: PersonalBests;
};

export type RewardsInput = Omit<BadgeInput, "streak">;

/** What you may spend per day in a month with this limit (rounded down to whole cents). */
export const dailyAllowance = (limitCents: number, year: number, month: number): number => logic("game.daily_allowance", { limit_cents: limitCents, year, month });

/** The same for a budget period of `days` days (a payday period is not a calendar month). */
export const dailyAllowanceForDays = (limitCents: number, days: number): number => logic("game.daily_allowance_for_days", { limit_cents: limitCents, days });

/** What you may spend per day on `date`, in the budget period (from `payday`) that contains it. */
export const dailyAllowanceOn = (limitCents: number, date: string, payday = 1): number => logic("game.daily_allowance_on", { limit_cents: limitCents, date, payday });

/** Cents spent (a positive number) in one category on one day; refunds reduce it. */
export const spentOn = (txs: Tx[], date: string, category: string): number => logic("game.spent_on", { txs, date, category });

/** Days in a row, ending today, within the daily allowance of a category (see `streakState` for freezes). */
export const streak = (txs: Tx[], limitCents: number, today: string, category = "groceries", payday = 1): number =>
  logic("game.streak", { txs, limit_cents: limitCents, today, category, payday });

export const quests = (p: Progress): Quest[] => logic("game.quests", { p });

export const xp = (done: number, streakDays: number): number => logic("game.xp", { done, streak_days: streakDays });

export const level = (totalXp: number): { level: number; title: string; into: number; size: number } => logic("game.level", { total_xp: totalXp });

/** What the mascot says, picked from the real situation. */
export const coachMessage = (args: {
  progress: Progress;
  streakDays: number;
  allowanceCents: number;
  spentTodayCents: number;
  /** A streak freeze covered today (see `streakState`). */
  freezeUsedToday?: boolean;
}): string => logic("game.coach_message", { args });

/** The mascot's mood: worried over today's goal, cheering on a long streak or a fresh win. */
export const moodFor = (args: {
  streakDays: number;
  allowanceCents: number;
  spentTodayCents: number;
  celebrating?: boolean;
  /** A streak freeze covered today: over the goal, but the streak is safe. */
  freezeUsedToday?: boolean;
}): Mood => logic("game.mood_for", { args });

/** The Monday of the week (ISO weeks) that contains `iso`. */
export const weekStart = (iso: string): string => logic("game.week_start", { iso });

/** The streak with freezes, replayed from your first booking (at most REPLAY_DAYS back) to today. */
export const streakState = (txs: Tx[], limitCents: number, today: string, category = "groceries", payday = 1): StreakState =>
  logic("game.streak_state", { txs, limit_cents: limitCents, today, category, payday });

/** Grocery spending of every complete week (Monday to Sunday, ending before `today`) inside your data. */
export const completeWeeks = (txs: Tx[], today: string, category = "groceries"): WeekTotal[] => logic("game.complete_weeks", { txs, today, category });

export const personalBests = (txs: Tx[], streak: StreakState, today: string, category = "groceries"): PersonalBests =>
  logic("game.personal_bests", { txs, streak, today, category });

/** The ids of all badges, in the order they are shown. */
export const badgeIds = (): string[] => logic("game.badge_ids");

/** Net cents put aside (category savings) in the budget period that contains `today`, up to today. */
export const savedThisPeriod = (txs: Tx[], today: string, payday = 1): number => logic("game.saved_this_period", { txs, today, payday });

/** Every badge, in display order, with whether (and on which day) it was earned. */
export const badges = (i: BadgeInput): Badge[] => logic("game.badges", { i, streak: i.streak });

/** The badges to celebrate now: earned, not in the persisted `seen` list and not celebrated earlier this session. */
export const freshBadges = (all: Badge[], seen: readonly string[], celebrated: ReadonlySet<string>): Badge[] =>
  logic("game.fresh_badges", { all, seen, celebrated: [...celebrated] });

export const computeRewards = (i: RewardsInput): Rewards => logic("game.compute_rewards", { i });

/** What the mascot says on the Trophies screen. */
export const trophyMessage = (r: Rewards): string => logic("game.trophy_message", { r });

/** Cheering when the collection is complete or just grew, otherwise happy. */
export const trophyMood = (r: Rewards, justEarned: boolean): Mood => logic("game.trophy_mood", { r, just_earned: justEarned });

/** Kept in step with Rust by a test. */
export const rustConstants = (): Record<string, number> => logic("game.constants");

/** The ids of all badges, as a constant for the screens that need them at import time. */
export const BADGE_IDS = ["first-week", "streak-30", "streak-saved", "week-under-budget", "month-under-budget", "no-spend-day", "savings-goal", "quest-master"];
