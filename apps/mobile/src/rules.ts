/**
 * Pure logic behind the rules screen and the recategorize / split sheets, kept free of React so
 * it can be unit-tested with plain Node. Money is integer cents throughout.
 */
import { formatCents, parseEuroInput } from "./format";

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

export function draftFromRule(r: RuleFields): RuleDraft {
  const euro = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
  return {
    pattern: r.pattern,
    kind: r.kind,
    sign: r.sign ?? "any",
    min: euro(r.min_cents),
    max: euro(r.max_cents),
    category: r.category,
  };
}

/** Turn the form into an API body, or say what is wrong with it. */
export function ruleFromDraft(d: RuleDraft): { rule: RuleFields } | { error: string } {
  const pattern = d.pattern.trim();
  if (!/\p{L}/u.test(pattern)) return { error: "The name needs at least one letter" };
  const parse = (text: string): number | null | "bad" => {
    if (!text.trim()) return null;
    const cents = parseEuroInput(text);
    return cents === null ? "bad" : cents;
  };
  const min = parse(d.min);
  const max = parse(d.max);
  if (min === "bad") return { error: `"${d.min}" is not a valid smallest amount` };
  if (max === "bad") return { error: `"${d.max}" is not a valid largest amount` };
  if (min !== null && max !== null && min > max) return { error: "The smallest amount is larger than the largest" };
  return {
    rule: {
      pattern,
      kind: d.kind,
      sign: d.sign === "any" ? null : d.sign,
      min_cents: min,
      max_cents: max,
      category: d.category,
    },
  };
}

/** One line for the list, e.g. `Name starts with "kiosk" · expenses · 5,00 € to 20,00 € → dining`. */
export function describeRule(r: RuleFields): string {
  const parts = [`Name ${MATCH_KIND_LABEL[r.kind]} "${r.pattern}"`];
  if (r.sign) parts.push(r.sign === "expense" ? "expenses" : "income");
  if (r.min_cents != null && r.max_cents != null) parts.push(`${formatCents(r.min_cents)} to ${formatCents(r.max_cents)}`);
  else if (r.min_cents != null) parts.push(`from ${formatCents(r.min_cents)}`);
  else if (r.max_cents != null) parts.push(`up to ${formatCents(r.max_cents)}`);
  return `${parts.join(" · ")} → ${r.category}`;
}

/** The ids with the one at `index` moved by `delta` places (clamped); unchanged ids when it cannot move. */
export function moveId(ids: number[], index: number, delta: -1 | 1): number[] {
  const to = index + delta;
  if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return ids;
  const out = ids.slice();
  [out[index], out[to]] = [out[to], out[index]];
  return out;
}

// ---- splitting ----

/** A part while editing: the amount is what you typed, always positive (the sign comes from the transaction). */
export type SplitDraftPart = { amount: string; category: string; note: string };

export type SplitPartBody = { amount_cents: number; category: string; note?: string | null };

/** Cents of the transaction still to hand out (positive), or negative when the parts exceed it. */
export function splitRemainder(totalCents: number, parts: SplitDraftPart[]): number {
  const used = parts.reduce((sum, p) => sum + (parseEuroInput(p.amount) ?? 0), 0);
  return Math.abs(totalCents) - used;
}

/** A first two-part draft: the whole amount in the transaction's category and an empty second part. */
export function initialSplit(totalCents: number, category: string | null | undefined): SplitDraftPart[] {
  return [
    { amount: (Math.abs(totalCents) / 100).toFixed(2).replace(".", ","), category: category ?? "other", note: "" },
    { amount: "", category: "other", note: "" },
  ];
}

/** Check the parts add up exactly and build the API body (amounts get the transaction's sign). */
export function splitFromDraft(totalCents: number, parts: SplitDraftPart[]): { parts: SplitPartBody[] } | { error: string } {
  if (totalCents === 0) return { error: "A transaction of 0 € cannot be split" };
  if (parts.length < 2) return { error: "A split needs at least two parts" };
  const sign = totalCents < 0 ? -1 : 1;
  const body: SplitPartBody[] = [];
  for (const [i, p] of parts.entries()) {
    const cents = parseEuroInput(p.amount);
    if (cents === null || cents === 0) return { error: `Part ${i + 1} needs an amount above 0` };
    const note = p.note.trim();
    body.push({ amount_cents: sign * cents, category: p.category, note: note || null });
  }
  const left = splitRemainder(totalCents, parts);
  if (left !== 0) {
    return { error: left > 0 ? `${formatCents(left)} still to assign` : `${formatCents(-left)} too much` };
  }
  return { parts: body };
}

export function draftFromSplit(parts: SplitPartBody[]): SplitDraftPart[] {
  return parts.map((p) => ({
    amount: (Math.abs(p.amount_cents) / 100).toFixed(2).replace(".", ","),
    category: p.category,
    note: p.note ?? "",
  }));
}
