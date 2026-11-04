// Editing a category definition. The server validates for real; these helpers build well-formed
// pieces so the editor cannot send nonsense, and give the form quick feedback. The rules are in Rust
// (crates/logic, shop_schema.rs).

import { logic } from "../../../wire/src/logic";
import type { AttrKind, CategorySchema } from "../api/types";

/** `Battery life (h)` -> `battery_life_h`. */
export const slugKey = (label: string): string => logic("shop_schema.slug_key", { label });

export const uniqueKey = (base: string, taken: string[]): string => logic("shop_schema.unique_key", { base, taken });

export const newCategory = (name: string, extendsId: string | null): CategorySchema => logic("shop_schema.new_category", { name, extends_id: extendsId });

export const addAttribute = (schema: CategorySchema, label: string, kind: AttrKind, unit?: string): { schema: CategorySchema; key: string } =>
  logic("shop_schema.add_attribute", { schema, label, kind, unit: unit ?? null });

/** Another name pages use for the attribute: the crawler then files that spec under it. */
export const addAlias = (schema: CategorySchema, key: string, alias: string): CategorySchema => logic("shop_schema.add_alias", { schema, key, alias });

/** Take a name back off an attribute. */
export const removeAlias = (schema: CategorySchema, key: string, alias: string): CategorySchema => logic("shop_schema.remove_alias", { schema, key, alias });

export type CriterionTemplate =
  | { kind: "number"; attribute: string; min: number; max: number; higherIsBetter: boolean }
  | { kind: "flag"; attribute: string }
  | { kind: "formula"; expr: string; min: number; max: number; higherIsBetter: boolean }
  | { kind: "match"; attribute: string; preference: string };

export const addCriterion = (schema: CategorySchema, label: string, t: CriterionTemplate, weight = 1): { schema: CategorySchema; key: string } =>
  logic("shop_schema.add_criterion", { schema, label, t, weight });

export const removeCriterion = (schema: CategorySchema, key: string): CategorySchema => logic("shop_schema.remove_criterion", { schema, key });
/**
 * A quick local check of a formula, for the form. It catches the usual typing mistakes
 * (unbalanced brackets, a trailing operator, characters the language does not have); the server
 * checks names and functions.
 */
export const formulaProblem = (expr: string): string | null => logic("shop_schema.formula_problem", { expr });

/** Names usable in a formula: the category's attributes and the offer values. */
export const formulaNames = (schema: CategorySchema): string[] => logic("shop_schema.formula_names", { schema });
