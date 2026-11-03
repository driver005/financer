// Saved priorities: the profiles stored under a name ("default" is the one searches use).

import type { Profile } from "../api/types";
import { formatCents } from "./format";

export const DEFAULT_PROFILE = "default";

/** What a profile asks for, in a few words: "3 priorities, 2 wishes, under 600 €, new only". */
export function profileSummary(p: Profile): string {
  const weights = Object.values(p.weights ?? {}).filter((w) => w > 0).length;
  const wishes = Object.values(p.preferences ?? {}).filter((x) => (x.prefer?.length ?? 0) + (x.avoid?.length ?? 0) > 0).length;
  const parts: string[] = [];
  if (weights) parts.push(`${weights} ${weights === 1 ? "priority" : "priorities"}`);
  if (wishes) parts.push(`${wishes} ${wishes === 1 ? "wish" : "wishes"}`);
  if (p.constraints?.length) parts.push(`${p.constraints.length} ${p.constraints.length === 1 ? "requirement" : "requirements"}`);
  if (p.max_price_cents) parts.push(`under ${formatCents(p.max_price_cents)}`);
  if (p.in_stock_only) parts.push("in stock only");
  if (p.conditions?.length === 1 && p.conditions[0] === "new") parts.push("new only");
  if (p.exclude_brands?.length) parts.push(`without ${p.exclude_brands.join(", ")}`);
  return parts.length ? parts.join(", ") : "Nothing set: everything counts the same";
}

/** A name for a copy: trimmed, one line, not "default" and not one already in use; a problem in words otherwise. */
export function profileNameProblem(name: string, existing: string[]): string | null {
  const t = name.trim();
  if (!t) return "Give it a name.";
  if (t.length > 40) return "Use at most 40 characters.";
  if (/[\n/\\?#]/.test(t)) return "Leave out line breaks and the characters / \\ ? #.";
  if (t.toLowerCase() === DEFAULT_PROFILE) return "That name is taken by the one searches use.";
  if (existing.some((n) => n.toLowerCase() === t.toLowerCase())) return "You already have one with that name.";
  return null;
}

/** The profiles with the one searches use first, then by name. */
export function orderProfiles<T extends { name: string }>(all: T[]): T[] {
  return [...all].sort((a, b) => (a.name === DEFAULT_PROFILE ? -1 : b.name === DEFAULT_PROFILE ? 1 : a.name.localeCompare(b.name)));
}
