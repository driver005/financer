// How important each criterion is. A person picks a level per criterion; the level is stored as
// a weight relative to the category's own default, so the defaults stay meaningful. The rules are in
// Rust (crates/logic, shop_weights.rs).

import { logic } from "../../../wire/src/logic";
import type { CategorySchema, CriterionDef, Profile } from "../api/types";

export type Level = "off" | "low" | "normal" | "high" | "essential";

export const LEVELS: Level[] = ["off", "low", "normal", "high", "essential"];

export const LEVEL_LABEL: Record<Level, string> = {
  off: "Ignore",
  low: "Minor",
  normal: "Normal",
  high: "Important",
  essential: "Essential",
};
/** The weight a level means for this criterion. A criterion whose default is 0 starts from 1. */
export const weightFor = (c: CriterionDef, level: Level): number => logic("shop_weights.weight_for", { c, level });

/** The level closest to a weight. */
export const levelOf = (c: CriterionDef, weight: number): Level => logic("shop_weights.level_of", { c, weight });

export const currentLevel = (c: CriterionDef, profile: Profile): Level => logic("shop_weights.current_level", { c, profile });

/** Set one criterion's level. Setting it back to its default removes the override. */
export const setLevel = (profile: Profile, c: CriterionDef, level: Level): Profile => logic("shop_weights.set_level", { profile, c, level });

export const resetWeights = (profile: Profile): Profile => logic("shop_weights.reset_weights", { profile });

/** Criteria the person can rate: the category's and the profile's own extras, each key once. */
export const ratable = (schema: CategorySchema, profile: Profile): CriterionDef[] => logic("shop_weights.ratable", { schema, profile });

export type Group = { id: string; label: string; criteria: CriterionDef[] };
/** Criteria by their `group`; ungrouped ones go last under "Other". */
export const groups = (criteria: CriterionDef[]): Group[] => logic("shop_weights.groups", { criteria });

export type Preset = { id: string; label: string; profile: Profile };

/**
 * Ready-made profiles from the schema itself: "Camera first" for every group the category
 * defines, plus "Cheapest that is good" and "Best of the best". New groups in a custom category
 * therefore get their presets without any code.
 */
export const presetsFor = (schema: CategorySchema, base: Profile = {}): Preset[] => logic("shop_weights.presets_for", { schema, base });
