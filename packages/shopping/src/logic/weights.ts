// How important each criterion is. A person picks a level per criterion; the level is stored as
// a weight relative to the category's own default, so the defaults stay meaningful.

import type { CategorySchema, CriterionDef, Profile } from "../api/types";

export type Level = "off" | "low" | "normal" | "high" | "essential";

export const LEVELS: Level[] = ["off", "low", "normal", "high", "essential"];

const FACTOR: Record<Level, number> = { off: 0, low: 0.4, normal: 1, high: 2.5, essential: 6 };

export const LEVEL_LABEL: Record<Level, string> = {
  off: "Ignore",
  low: "Minor",
  normal: "Normal",
  high: "Important",
  essential: "Essential",
};

export function defaultWeight(c: CriterionDef): number {
  return c.weight ?? 1;
}

/** The weight a level means for this criterion. A criterion whose default is 0 starts from 1. */
export function weightFor(c: CriterionDef, level: Level): number {
  const base = defaultWeight(c) > 0 ? defaultWeight(c) : 1;
  return level === "off" ? 0 : round(base * FACTOR[level]);
}

/** The level closest to a weight. */
export function levelOf(c: CriterionDef, weight: number): Level {
  if (weight <= 0) return "off";
  const base = defaultWeight(c) > 0 ? defaultWeight(c) : 1;
  const ratio = weight / base;
  let best: Level = "normal";
  let bestDistance = Infinity;
  for (const level of LEVELS) {
    if (level === "off") continue;
    const distance = Math.abs(Math.log(ratio / FACTOR[level]));
    if (distance < bestDistance) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}

export function currentLevel(c: CriterionDef, profile: Profile): Level {
  const w = profile.weights?.[c.key];
  return w === undefined ? (defaultWeight(c) > 0 ? "normal" : "off") : levelOf(c, w);
}

/** Set one criterion's level. Setting it back to its default removes the override. */
export function setLevel(profile: Profile, c: CriterionDef, level: Level): Profile {
  const weights = { ...(profile.weights ?? {}) };
  const isDefault = level === (defaultWeight(c) > 0 ? "normal" : "off");
  if (isDefault) delete weights[c.key];
  else weights[c.key] = weightFor(c, level);
  return { ...profile, weights };
}

export function resetWeights(profile: Profile): Profile {
  return { ...profile, weights: {} };
}

/** Criteria the person can rate: everything except those that cannot apply without a wish. */
export function ratable(schema: CategorySchema, profile: Profile): CriterionDef[] {
  const all = [...(schema.criteria ?? []), ...(profile.extra_criteria ?? [])];
  const seen = new Set<string>();
  return all.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
}

export type Group = { id: string; label: string; criteria: CriterionDef[] };

const GROUP_LABEL: Record<string, string> = {
  cost: "Price and deals",
  speed: "Speed",
  camera: "Camera",
  battery: "Battery",
  display: "Display",
  memory: "Memory",
  longevity: "Lasting value",
  fit: "Fits my other devices",
  build: "Build",
  connectivity: "Connectivity",
};

export function groupLabel(id: string): string {
  return GROUP_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, " ");
}

/** Criteria by their `group`; ungrouped ones go last under "Other". */
export function groups(criteria: CriterionDef[]): Group[] {
  const map = new Map<string, CriterionDef[]>();
  for (const c of criteria) {
    const id = c.group ?? "other";
    map.set(id, [...(map.get(id) ?? []), c]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === "other" ? 1 : b === "other" ? -1 : 0))
    .map(([id, list]) => ({ id, label: id === "other" ? "Other" : groupLabel(id), criteria: list }));
}

export type Preset = { id: string; label: string; profile: Profile };

/**
 * Ready-made profiles from the schema itself: "Camera first" for every group the category
 * defines, plus "Cheapest that is good" and "Best of the best". New groups in a custom category
 * therefore get their presets without any code.
 */
export function presetsFor(schema: CategorySchema, base: Profile = {}): Preset[] {
  const criteria = ratable(schema, base);
  const costKeys = criteria.filter((c) => c.kind === "price" || c.kind === "deal").map((c) => c.key);
  const priceKeys = criteria.filter((c) => c.kind === "price").map((c) => c.key);
  const out: Preset[] = [{ id: "balanced", label: "Balanced", profile: { ...base, weights: {} } }];
  const withWeights = (weights: Record<string, number>): Profile => ({ ...base, weights });

  for (const g of groups(criteria)) {
    if (g.id === "cost" || g.id === "other" || g.id === "fit") continue;
    const w: Record<string, number> = {};
    for (const c of g.criteria) w[c.key] = weightFor(c, "essential");
    out.push({ id: `group:${g.id}`, label: `${g.label} first`, profile: withWeights(w) });
  }
  if (priceKeys.length > 0) {
    const w: Record<string, number> = {};
    for (const c of criteria) if (priceKeys.includes(c.key)) w[c.key] = weightFor(c, "essential");
    out.push({ id: "cheapest", label: "Cheapest that is still good", profile: withWeights(w) });
    const best: Record<string, number> = {};
    for (const k of costKeys) best[k] = 0;
    out.push({ id: "best", label: "Best, whatever it costs", profile: withWeights(best) });
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
