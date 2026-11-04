/**
 * The rules screen and the recategorize / split sheets: the rules (turning the form into an API body,
 * describing a rule, splitting a booking) are in Rust (crates/logic, rules.rs). Money is integer cents
 * throughout. The category and match-kind lists are here because the screen draws them.
 */
import { logic } from "../../../packages/wire/src/logic";

/** Every category a transaction can have (the API's snake_case names). */
export const CATEGORIES = [
  "groceries", "dining", "transport", "housing", "utilities", "insurance", "subscriptions",
  "health", "leisure", "shopping", "cash", "savings", "income", "other",
] as const;
export type CategoryName = (typeof CATEGORIES)[number];

export type MatchKind = "contains" | "equals" | "starts_with";
export type RuleSign = "expense" | "income";

export const MATCH_KIND_LABEL: Record<MatchKind, string> = {
  contains: "contains",
  equals: "is exactly",
  starts_with: "starts with",
};

/** The shape the API stores for a rule (`RuleDto`/`RuleInput`, with the enum fields narrowed). */
export type RuleFields = {
  pattern: string;
  kind: MatchKind;
  sign?: RuleSign | null;
  min_cents?: number | null;
  max_cents?: number | null;
  category: string;
};

/** What the rule form holds while editing: everything as text. */
export type RuleDraft = {
  pattern: string;
  kind: MatchKind;
  sign: RuleSign | "any";
  min: string;
  max: string;
  category: string;
};

export const EMPTY_DRAFT: RuleDraft = { pattern: "", kind: "contains", sign: "any", min: "", max: "", category: "groceries" };

export const draftFromRule = (r: RuleFields): RuleDraft => logic("rules.draft_from_rule", { r });

/** Turn the form into an API body, or say what is wrong with it. */
export const ruleFromDraft = (d: RuleDraft): { rule: RuleFields } | { error: string } => logic("rules.rule_from_draft", { d });

/** One line for the list, e.g. `Name starts with "kiosk" · expenses · 5,00 € to 20,00 € → dining`. */
export const describeRule = (r: RuleFields): string => logic("rules.describe_rule", { r });

/** The ids with the one at `index` moved by `delta` places (clamped); unchanged ids when it cannot move. */
export const moveId = (ids: number[], index: number, delta: -1 | 1): number[] => logic("rules.move_id", { ids, index, delta });

// ---- splitting ----

/** A part while editing: the amount is what you typed, always positive (the sign comes from the transaction). */
export type SplitDraftPart = { amount: string; category: string; note: string };

export type SplitPartBody = { amount_cents: number; category: string; note?: string | null };

/** Cents of the transaction still to hand out (positive), or negative when the parts exceed it. */
export const splitRemainder = (totalCents: number, parts: SplitDraftPart[]): number => logic("rules.split_remainder", { total_cents: totalCents, parts });

/** A first two-part draft: the whole amount in the transaction's category and an empty second part. */
export const initialSplit = (totalCents: number, category: string | null | undefined): SplitDraftPart[] =>
  logic("rules.initial_split", { total_cents: totalCents, category: category ?? null });

/** Check the parts add up exactly and build the API body (amounts get the transaction's sign). */
export const splitFromDraft = (totalCents: number, parts: SplitDraftPart[]): { parts: SplitPartBody[] } | { error: string } =>
  logic("rules.split_from_draft", { total_cents: totalCents, parts });

export const draftFromSplit = (parts: SplitPartBody[]): SplitDraftPart[] => logic("rules.draft_from_split", { parts });
