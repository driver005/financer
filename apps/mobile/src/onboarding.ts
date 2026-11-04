/**
 * First-run setup: which steps there are for a build, how far along the user is, what a typed value
 * means, how a savings level turns into a daily grocery allowance, what the mascot says, and whether
 * the app should send someone to the setup at all. The rules are in Rust (crates/logic, onboarding.rs);
 * this file holds the types and the lists the screens draw.
 *
 * The screens are in `components/onboarding/` and the route `app/onboarding.tsx`; storage is in
 * `native/onboardingStore.ts`.
 */

import type { Chain } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";

// ---- steps ----

export const STEP_IDS = ["welcome", "data", "household", "rhythm", "habits", "money", "safety", "finish"] as const;
export type StepId = (typeof STEP_IDS)[number];

export type Platform = "web" | "ios" | "android";

/** What the running build can do; decides which steps and options apply. */
export type BuildInfo = { platform: Platform; embeddedAvailable: boolean };

/** The steps for this build, in order ("safety" only exists in the phone app). */
export const stepsFor = (build: BuildInfo): StepId[] => logic("onboarding.steps_for", { platform: build.platform });

export const isStepId = (value: unknown): value is StepId =>
  typeof value === "string" && logic<boolean>("onboarding.is_step_id", { value });

/** The step after `current`, or `null` at the end (or when `current` is not in the list). */
export const nextStep = (steps: StepId[], current: StepId): StepId | null => logic("onboarding.next_step", { steps, current });

/** The step before `current`, or `null` on the first step. */
export const previousStep = (steps: StepId[], current: StepId): StepId | null => logic("onboarding.previous_step", { steps, current });

/** Where the progress bar stands: 0 on the first step, 1 on the last. */
export const progressOf = (steps: StepId[], current: StepId): { index: number; total: number; fraction: number } =>
  logic("onboarding.progress_of", { steps, current });

/** A stored step that this build no longer has moves on to the next one that exists. */
export const resolveStep = (steps: StepId[], stored: StepId): StepId => logic("onboarding.resolve_step", { steps, stored });

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

/** Keep only well-formed fields of a stored draft (the file may be old, edited or damaged). */
export const sanitizeDraft = (raw: unknown): Draft => logic("onboarding.sanitize_draft", { raw: raw ?? null });

/** Read a stored state; `null` for nothing or garbage (start from the top). */
export const parseState = (raw: string | null | undefined): OnboardingState | null => logic("onboarding.parse_state", { raw: raw ?? null });

export function serializeState(state: OnboardingState): string {
  return JSON.stringify(state);
}

// ---- validation ----

export const HOUSEHOLD_MIN = 1;
export const HOUSEHOLD_MAX = 8;
/** 10.000 EUR: far above any grocery budget, there to catch a typo like an extra zero. */
export const MAX_BUDGET_CENTS = 1_000_000;

export const clampHousehold = (n: number): number => logic("onboarding.clamp_household", { n });

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** An optional 5-digit German postal code; empty is fine (`value: null`). */
export const parsePostalCode = (input: string): Parsed<string | null> => logic("onboarding.parse_postal_code", { input });

/** An optional euro amount; empty is fine (`value: null`). */
export const parseBudget = (input: string): Parsed<number | null> => logic("onboarding.parse_budget", { input });

/** A weekly budget as a per-month amount (52 weeks over 12 months); monthly stays as it is. */
export const monthlyGroceryCents = (cents: number, cadence: Cadence): number => logic("onboarding.monthly_grocery_cents", { cents, cadence });

/**
 * Check the server address and token before testing the connection. Errors block the test;
 * a warning (plain http to a host that is not on your own network) is shown but allowed.
 */
export const validateServer = (url: string, token: string): { ok: boolean; error?: string; warning?: string; normalized: string } =>
  logic("onboarding.validate_server", { url, token });

// ---- savings levels and the daily allowance ----

export type IntensityInfo = { id: Intensity; label: string; blurb: string; factor: number; icon: string };

/** Three named levels. The factor scales the starting point (the same numbers are in onboarding.rs). */
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

export const householdFactor = (size: number): number => logic("onboarding.household_factor", { size });

/** The daily grocery allowance (cents) a savings level suggests, rounded to 10 cents. */
export const suggestAllowance = (args: {
  intensity: Intensity;
  householdSize?: number;
  groceryBudgetCents?: number;
  groceryCadence?: Cadence;
}): number => logic("onboarding.suggest_allowance", { args });

/**
 * The grocery limit for the budget period containing `today`, in cents, or `null` if the user
 * gave neither a daily allowance nor a budget.
 */
export const groceryLimitFor = (draft: Draft, today: string): number | null => logic("onboarding.grocery_limit_for", { draft, today });

// ---- the profile that outlives the setup ----

/**
 * What the app has no server-side field for: household size, stores, postal code. It is kept on
 * the device (key `financer.profile`) so it survives the end of the setup, which forgets its draft.
 */
export type Profile = { householdSize?: number; chains?: Chain[]; postalCode?: string };

export const parseProfile = (raw: string | null | undefined): Profile => logic("onboarding.parse_profile", { raw: raw ?? null });

/** The stored profile with the answers of this run on top; unanswered questions keep what was there. */
export const mergeProfile = (existing: Profile, draft: Draft): Profile => logic("onboarding.merge_profile", { existing, draft });

// ---- applying the answers ----

export type EnvelopeLike = { category: string; limit_cents: number };

export type ApplyPlan = {
  payday?: number;
  habitMode?: HabitMode;
  /** The full envelope list to save (the user's others kept, groceries replaced), or `null` to leave the budget alone. */
  envelopes: EnvelopeLike[] | null;
};

/** What to write to the backend for these answers; unanswered questions write nothing. */
export const planApply = (draft: Draft, today: string, existing: EnvelopeLike[]): ApplyPlan =>
  logic("onboarding.plan_apply", { draft, today, existing });

// ---- the mascot ----

export type MascotLine = { message: string; mood: "happy" | "cheer" | "worried" };

/** What Penny says for the current answers on a step. */
export const mascotFor = (step: StepId, draft: Draft, build: BuildInfo): MascotLine =>
  logic("onboarding.mascot_for", { step, draft, embedded_available: build.embeddedAvailable });

// ---- recap and first quest ----

export type RecapRow = { label: string; value: string };

export const recapRows = (draft: Draft, build: BuildInfo): RecapRow[] => logic("onboarding.recap_rows", { draft, platform: build.platform });

export type FirstQuest = { title: string; hint: string; route: "/spending" | "/mealplan" };

/** With bookings in the app the next useful thing is planning the week; without, adding bookings. */
export const firstQuest = (draft: Draft): FirstQuest => logic("onboarding.first_quest", { draft });

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
 * set the app up before this feature existed is not forced through it; an unfinished setup is resumed.
 */
export const entryAction = (i: EntryInput): EntryAction => logic("onboarding.entry_action", { i });
