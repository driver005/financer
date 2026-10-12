/**
 * First-run setup: the pure logic. Which steps there are for a build, how far along the user is,
 * what a typed value means, how a savings level turns into a daily grocery allowance, what the
 * mascot says, and whether the app should send someone to the setup at all.
 *
 * No React Native or Expo imports, so all of it runs in the unit tests. The screens are in
 * `components/onboarding/` and the route `app/onboarding.tsx`; storage is in
 * `native/onboardingStore.ts`.
 */

import type { Chain } from "./api/client";
import { formatCents, parseEuroInput } from "./format";
import { budgetPeriod, periodDays } from "./period";

// ---- steps ----

export const STEP_IDS = ["welcome", "data", "household", "rhythm", "habits", "money", "safety", "finish"] as const;
export type StepId = (typeof STEP_IDS)[number];

export type Platform = "web" | "ios" | "android";

/** What the running build can do; decides which steps and options apply. */
export type BuildInfo = { platform: Platform; embeddedAvailable: boolean };

/**
 * The steps for this build, in order. The "safety" step (app lock and notifications) only exists
 * in the phone app: in the browser there is nothing to unlock with and nothing to notify through.
 */
export function stepsFor(build: BuildInfo): StepId[] {
  return STEP_IDS.filter((id) => id !== "safety" || build.platform !== "web");
}

export function isStepId(value: unknown): value is StepId {
  return typeof value === "string" && (STEP_IDS as readonly string[]).includes(value);
}

/** The step after `current`, or `null` at the end (or when `current` is not in the list). */
export function nextStep(steps: StepId[], current: StepId): StepId | null {
  const i = steps.indexOf(current);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1] : null;
}

/** The step before `current`, or `null` on the first step. */
export function previousStep(steps: StepId[], current: StepId): StepId | null {
  const i = steps.indexOf(current);
  return i > 0 ? steps[i - 1] : null;
}

/** Where the progress bar stands: 0 on the first step, 1 on the last. */
export function progressOf(steps: StepId[], current: StepId): { index: number; total: number; fraction: number } {
  const total = steps.length;
  const index = Math.max(0, steps.indexOf(current));
  return { index, total, fraction: total > 1 ? index / (total - 1) : 1 };
}

/** A stored step that this build no longer has (e.g. "safety" saved on a phone, resumed in a browser) moves on to the next one that exists. */
export function resolveStep(steps: StepId[], stored: StepId): StepId {
  if (steps.includes(stored)) return stored;
  const from = STEP_IDS.indexOf(stored);
  return STEP_IDS.slice(from + 1).find((id) => steps.includes(id)) ?? steps[steps.length - 1];
}

// ---- the answers ----

export type HabitMode = "manual" | "receipts" | "spending";
export type Intensity = "casual" | "regular" | "serious";
export type Cadence = "weekly" | "monthly";
export type BackendChoice = "embedded" | "server";

export const CHAINS: Chain[] = ["lidl", "aldi", "kaufland", "rewe"];
export const CHAIN_NAMES: Record<Chain, string> = { lidl: "Lidl", aldi: "Aldi", kaufland: "Kaufland", rewe: "Rewe" };

/**
 * Everything the user has answered so far. Every field is optional: a skipped question stays
 * unset and is simply not applied, so skipping never overwrites what the app already has.
 */
export type Draft = {
  backend?: BackendChoice;
  householdSize?: number;
  /** The grocery budget as typed, in cents, per `groceryCadence`. */
  groceryBudgetCents?: number;
  groceryCadence?: Cadence;
  chains?: Chain[];
  postalCode?: string;
  payday?: number;
  intensity?: Intensity;
  /** Grocery allowance per day in cents (suggested from the level, then editable). */
  dailyAllowanceCents?: number;
  habitMode?: HabitMode;
  /** Money step: demo bookings were loaded (so the recap and the first quest can say so). */
  demoLoaded?: boolean;
  /** Money step: bookings the user imported from a CSV file. */
  csvImported?: number;
  /** Safety step. */
  lockOn?: boolean;
  notifyKinds?: string[];
};

export type OnboardingState = { v: 1; step: StepId; draft: Draft };

export function newState(step: StepId = "welcome"): OnboardingState {
  return { v: 1, step, draft: {} };
}

const HABIT_MODES: HabitMode[] = ["manual", "receipts", "spending"];
const INTENSITY_IDS: Intensity[] = ["casual", "regular", "serious"];

function isInt(n: unknown, min: number, max: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
}

/** Keep only well-formed fields of a stored draft (the file may be old, edited or damaged). */
export function sanitizeDraft(raw: unknown): Draft {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const d: Draft = {};
  if (r.backend === "embedded" || r.backend === "server") d.backend = r.backend;
  if (isInt(r.householdSize, HOUSEHOLD_MIN, HOUSEHOLD_MAX)) d.householdSize = r.householdSize;
  if (isInt(r.groceryBudgetCents, 1, MAX_BUDGET_CENTS)) d.groceryBudgetCents = r.groceryBudgetCents;
  if (r.groceryCadence === "weekly" || r.groceryCadence === "monthly") d.groceryCadence = r.groceryCadence;
  if (Array.isArray(r.chains)) d.chains = CHAINS.filter((c) => (r.chains as unknown[]).includes(c));
  if (typeof r.postalCode === "string" && /^\d{5}$/.test(r.postalCode)) d.postalCode = r.postalCode;
  if (isInt(r.payday, 1, 28)) d.payday = r.payday;
  if (INTENSITY_IDS.includes(r.intensity as Intensity)) d.intensity = r.intensity as Intensity;
  if (isInt(r.dailyAllowanceCents, 1, MAX_BUDGET_CENTS)) d.dailyAllowanceCents = r.dailyAllowanceCents;
  if (HABIT_MODES.includes(r.habitMode as HabitMode)) d.habitMode = r.habitMode as HabitMode;
  if (r.demoLoaded === true) d.demoLoaded = true;
  if (isInt(r.csvImported, 0, 10_000_000)) d.csvImported = r.csvImported;
  if (typeof r.lockOn === "boolean") d.lockOn = r.lockOn;
  if (Array.isArray(r.notifyKinds)) d.notifyKinds = r.notifyKinds.filter((k): k is string => typeof k === "string").slice(0, 8);
  return d;
}

/** Read a stored state; `null` for nothing or garbage (start from the top). */
export function parseState(raw: string | null | undefined): OnboardingState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { v?: unknown; step?: unknown; draft?: unknown };
    if (v?.v !== 1 || !isStepId(v.step)) return null;
    return { v: 1, step: v.step, draft: sanitizeDraft(v.draft) };
  } catch {
    return null;
  }
}

export function serializeState(state: OnboardingState): string {
  return JSON.stringify(state);
}

// ---- validation ----

export const HOUSEHOLD_MIN = 1;
export const HOUSEHOLD_MAX = 8;
/** 10.000 EUR: far above any grocery budget, there to catch a typo like an extra zero. */
export const MAX_BUDGET_CENTS = 1_000_000;

export function clampHousehold(n: number): number {
  return Math.min(HOUSEHOLD_MAX, Math.max(HOUSEHOLD_MIN, Math.trunc(Number.isFinite(n) ? n : HOUSEHOLD_MIN)));
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** An optional 5-digit German postal code; empty is fine (`value: null`). */
export function parsePostalCode(input: string): Parsed<string | null> {
  const s = input.trim();
  if (s === "") return { ok: true, value: null };
  if (!/^\d{5}$/.test(s)) return { ok: false, error: "A German postal code has 5 digits, like 10115." };
  return { ok: true, value: s };
}

/** An optional euro amount; empty is fine (`value: null`). */
export function parseBudget(input: string): Parsed<number | null> {
  const typed = input.trim();
  if (typed === "") return { ok: true, value: null };
  // a phone keyboard may offer a decimal point: "59.90" means 59,90 here, not 5990
  const cents = parseEuroInput(/^\d+\.\d{1,2}$/.test(typed) ? typed.replace(".", ",") : typed);
  if (cents === null) return { ok: false, error: "Enter an amount like 60 or 59,90." };
  if (cents <= 0) return { ok: false, error: "The budget has to be more than 0." };
  if (cents > MAX_BUDGET_CENTS) return { ok: false, error: "That is more than 10.000 EUR. Check the amount." };
  return { ok: true, value: cents };
}

/** A weekly budget as a per-month amount (52 weeks over 12 months); monthly stays as it is. */
export function monthlyGroceryCents(cents: number, cadence: Cadence): number {
  return cadence === "weekly" ? Math.round((cents * 52) / 12) : cents;
}

/**
 * Check the server address and token before testing the connection. Errors block the test;
 * a warning (plain http to a host that is not on your own network) is shown but allowed.
 */
export function validateServer(url: string, token: string): { ok: boolean; error?: string; warning?: string; normalized: string } {
  const trimmed = url.trim();
  const normalized = trimmed.replace(/\/+$/, "");
  if (!trimmed) return { ok: false, error: "Enter the address of your server.", normalized };
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { ok: false, error: "That does not look like an address. Start with https://", normalized };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "The address has to start with https:// (or http:// on your own network).", normalized };
  }
  if (!token.trim()) return { ok: false, error: "Enter the API token you set on the server.", normalized };
  const host = parsed.hostname;
  const local =
    host === "localhost" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (parsed.protocol === "http:" && !local) {
    return { ok: true, warning: "This address is not encrypted (http). Your token and data would travel in the clear. Use https://.", normalized };
  }
  return { ok: true, normalized };
}

// ---- savings levels and the daily allowance ----

export type IntensityInfo = { id: Intensity; label: string; blurb: string; factor: number; icon: string };

/**
 * Three named levels. The factor scales the starting point: 100% of a comfortable shop for Casual,
 * 85% for Regular, 70% for Serious.
 */
export const INTENSITIES: IntensityInfo[] = [
  { id: "casual", label: "Casual", blurb: "A relaxed shop. Small wins, no stress.", factor: 1, icon: "leaf" },
  { id: "regular", label: "Regular", blurb: "Plan the shop and skip the extras.", factor: 0.85, icon: "flash" },
  { id: "serious", label: "Serious", blurb: "Every cent counts. Offers and own brands.", factor: 0.7, icon: "fire" },
];

/** A round planning figure for one adult's groceries per day, used only when no budget was entered. Not a statistic. */
export const BASE_DAILY_PER_PERSON_CENTS = 650;
/** Each person after the first adds 85% of the first (packs and staples are shared). */
export const EXTRA_PERSON_WEIGHT = 0.85;
export const MIN_ALLOWANCE_CENTS = 100;
const AVG_DAYS_PER_MONTH = 365 / 12;

export function householdFactor(size: number): number {
  return 1 + EXTRA_PERSON_WEIGHT * (clampHousehold(size) - 1);
}

/**
 * The daily grocery allowance (cents) a savings level suggests. It starts from the budget the
 * user entered (spread over the days of a month) or, without one, from the household size, then
 * scales by the level and rounds to 10 cents.
 */
export function suggestAllowance(args: {
  intensity: Intensity;
  householdSize?: number;
  groceryBudgetCents?: number;
  groceryCadence?: Cadence;
}): number {
  const level = INTENSITIES.find((i) => i.id === args.intensity) ?? INTENSITIES[0];
  const start =
    args.groceryBudgetCents !== undefined
      ? monthlyGroceryCents(args.groceryBudgetCents, args.groceryCadence ?? "monthly") / AVG_DAYS_PER_MONTH
      : BASE_DAILY_PER_PERSON_CENTS * householdFactor(args.householdSize ?? 1);
  return Math.max(MIN_ALLOWANCE_CENTS, Math.round((start * level.factor) / 10 + 1e-9) * 10);
}

/**
 * The grocery limit for the budget period containing `today`, in cents, or `null` if the user
 * gave neither a daily allowance nor a budget. A daily allowance wins (it is what the Today
 * screen shows); it is spread over the days of the period so `floor(limit / days)` gives it back.
 */
export function groceryLimitFor(draft: Draft, today: string): number | null {
  if (draft.dailyAllowanceCents !== undefined) {
    const days = periodDays(budgetPeriod(today, draft.payday ?? 1));
    return draft.dailyAllowanceCents * days;
  }
  if (draft.groceryBudgetCents !== undefined) {
    return monthlyGroceryCents(draft.groceryBudgetCents, draft.groceryCadence ?? "monthly");
  }
  return null;
}

// ---- the profile that outlives the setup ----

/**
 * What the app has no server-side field for: household size, stores, postal code. It is kept on
 * the device (key `financer.profile`) so it survives the end of the setup, which forgets its draft.
 */
export type Profile = { householdSize?: number; chains?: Chain[]; postalCode?: string };

export function parseProfile(raw: string | null | undefined): Profile {
  if (!raw) return {};
  try {
    const d = sanitizeDraft(JSON.parse(raw));
    const p: Profile = {};
    if (d.householdSize !== undefined) p.householdSize = d.householdSize;
    if (d.chains !== undefined) p.chains = d.chains;
    if (d.postalCode !== undefined) p.postalCode = d.postalCode;
    return p;
  } catch {
    return {};
  }
}

/** The stored profile with the answers of this run on top; unanswered questions keep what was there. */
export function mergeProfile(existing: Profile, draft: Draft): Profile {
  const next: Profile = { ...existing };
  if (draft.householdSize !== undefined) next.householdSize = draft.householdSize;
  if (draft.chains !== undefined) next.chains = draft.chains;
  if (draft.postalCode !== undefined) next.postalCode = draft.postalCode;
  return next;
}

// ---- applying the answers ----

export type EnvelopeLike = { category: string; limit_cents: number };

export type ApplyPlan = {
  payday?: number;
  habitMode?: HabitMode;
  /** The full envelope list to save (the user's others kept, groceries replaced), or `null` to leave the budget alone. */
  envelopes: EnvelopeLike[] | null;
};

/** What to write to the backend for these answers; unanswered questions write nothing. */
export function planApply(draft: Draft, today: string, existing: EnvelopeLike[]): ApplyPlan {
  const limit = groceryLimitFor(draft, today);
  return {
    payday: draft.payday,
    habitMode: draft.habitMode,
    envelopes:
      limit === null ? null : [...existing.filter((e) => e.category !== "groceries"), { category: "groceries", limit_cents: limit }],
  };
}

// ---- the mascot ----

export type MascotLine = { message: string; mood: "happy" | "cheer" | "worried" };

/** What Penny says for the current answers on a step. */
export function mascotFor(step: StepId, draft: Draft, build: BuildInfo): MascotLine {
  switch (step) {
    case "welcome":
      return { message: "Hi, I'm Penny! Let's find out what you can spend and what to buy.", mood: "happy" };
    case "data":
      if (draft.backend === "embedded") return { message: "On your phone it is. Private, and no hosting bill!", mood: "cheer" };
      if (draft.backend === "server") return { message: "Your own server. Always on, and shared across your devices.", mood: "happy" };
      return {
        message: build.embeddedAvailable ? "Where should I keep your numbers? Both choices are fine." : "Where do your numbers live? This build talks to a server.",
        mood: "happy",
      };
    case "household": {
      const n = draft.householdSize;
      if (!n) return { message: "Who are we shopping for?", mood: "happy" };
      const chains = draft.chains?.length ?? 0;
      if (chains === 0) return { message: n === 1 ? "Cooking for one. Easy to plan!" : `A household of ${n}. I'll plan for everyone.`, mood: "happy" };
      return {
        message: `${chains === 1 ? CHAIN_NAMES[draft.chains![0]] : `${chains} stores`} for ${n === 1 ? "one" : `${n} people`}. I'll compare prices there first.`,
        mood: "cheer",
      };
    }
    case "rhythm": {
      const level = INTENSITIES.find((i) => i.id === draft.intensity);
      if (!level || draft.dailyAllowanceCents === undefined) return { message: "How hard do you want to save? You can change it any time.", mood: "happy" };
      const n = formatCents(draft.dailyAllowanceCents);
      if (level.id === "casual") return { message: `Casual it is. About ${n} a day, no pressure.`, mood: "happy" };
      if (level.id === "regular") return { message: `Regular. ${n} a day is a solid plan.`, mood: "cheer" };
      return { message: `Serious! ${n} a day. I'll cheer every day you stay under.`, mood: "cheer" };
    }
    case "habits":
      if (draft.habitMode === "manual") return { message: "Your own list. You decide what is in the basket.", mood: "happy" };
      if (draft.habitMode === "receipts") return { message: "Receipts teach me what you really buy. Smart!", mood: "cheer" };
      if (draft.habitMode === "spending") return { message: "Spending only. I'll estimate with a generic basket.", mood: "happy" };
      return { message: "Your bank only shows the total, not the bag. How should I learn?", mood: "happy" };
    case "money":
      if (draft.demoLoaded) return { message: "Demo data is in. Have a look at Today, all of it is labelled DEMO.", mood: "cheer" };
      if ((draft.csvImported ?? 0) > 0) return { message: "Your bookings are in. Now we can do real maths!", mood: "cheer" };
      return { message: "Want numbers to play with? Everything here is optional.", mood: "happy" };
    case "safety":
      return { message: "Two small things: a lock for the app, and nudges when they help.", mood: "happy" };
    case "finish":
      return { message: "All set! Your first quest is waiting.", mood: "cheer" };
  }
}

// ---- recap and first quest ----

export type RecapRow = { label: string; value: string };

export function recapRows(draft: Draft, build: BuildInfo): RecapRow[] {
  const rows: RecapRow[] = [];
  if (draft.backend) {
    rows.push({ label: "Data", value: draft.backend === "embedded" ? "On this phone" : "Your own server" });
  }
  if (draft.householdSize) rows.push({ label: "Household", value: `${draft.householdSize} ${draft.householdSize === 1 ? "person" : "people"}` });
  if (draft.chains && draft.chains.length) rows.push({ label: "Stores", value: draft.chains.map((c) => CHAIN_NAMES[c]).join(", ") });
  if (draft.postalCode) rows.push({ label: "Postal code", value: draft.postalCode });
  if (draft.payday) rows.push({ label: "Payday", value: draft.payday === 1 ? "Calendar month" : `Day ${draft.payday}` });
  if (draft.intensity) {
    const level = INTENSITIES.find((i) => i.id === draft.intensity)!;
    rows.push({ label: "Saving level", value: level.label });
  }
  if (draft.dailyAllowanceCents !== undefined) rows.push({ label: "Grocery goal", value: `${formatCents(draft.dailyAllowanceCents)} a day` });
  else if (draft.groceryBudgetCents !== undefined) {
    rows.push({ label: "Grocery budget", value: `${formatCents(draft.groceryBudgetCents)} ${draft.groceryCadence === "weekly" ? "a week" : "a month"}` });
  }
  if (draft.habitMode) {
    rows.push({ label: "Learning your items", value: { manual: "My own list", receipts: "Receipts", spending: "Spending only" }[draft.habitMode] });
  }
  if (draft.demoLoaded) rows.push({ label: "Bookings", value: "Demo data (labelled DEMO)" });
  else if ((draft.csvImported ?? 0) > 0) rows.push({ label: "Bookings", value: `${draft.csvImported} imported from CSV` });
  if (build.platform !== "web") {
    if (draft.lockOn) rows.push({ label: "App lock", value: "On" });
    if (draft.notifyKinds && draft.notifyKinds.length) rows.push({ label: "Reminders", value: `${draft.notifyKinds.length} on` });
  }
  return rows;
}

export type FirstQuest = { title: string; hint: string; route: "/spending" | "/mealplan" };

/** With bookings in the app the next useful thing is planning the week; without, adding bookings. */
export function firstQuest(draft: Draft): FirstQuest {
  const hasBookings = draft.demoLoaded || (draft.csvImported ?? 0) > 0;
  return hasBookings
    ? { title: "Plan this week", hint: "Pick meals and see what the shop costs at your stores.", route: "/mealplan" }
    : { title: "Add your first transaction", hint: "Import a CSV or sync your bank so Today has numbers.", route: "/spending" };
}

// ---- should the app show the setup? ----

/** What storage says about the setup; `null` while it has not been read yet. */
export type Stored = { done: boolean; state: OnboardingState | null } | null;

export type EntryInput = {
  stored: Stored;
  /** The API configuration has been read (`loaded` in `useApi`). */
  apiLoaded: boolean;
  /** A server address and token are saved, or the on-phone backend is switched on. */
  configured: boolean;
  /** The user is on the setup screen right now. */
  onOnboarding: boolean;
};

export type EntryAction = "wait" | "stay" | "redirect" | "mark_done";

/**
 * First run shows the setup; afterwards never, unless replayed from Settings. Someone who already
 * set the app up (server or on-phone mode) before this feature existed is not forced through it:
 * the flag is set silently. A setup that was started and not finished is resumed, even if the
 * connection was saved on the way.
 */
export function entryAction(i: EntryInput): EntryAction {
  if (i.stored === null || !i.apiLoaded) return "wait";
  if (i.stored.done) return "stay";
  if (i.onOnboarding) return "stay";
  if (i.stored.state !== null) return "redirect";
  if (i.configured) return "mark_done";
  return "redirect";
}
