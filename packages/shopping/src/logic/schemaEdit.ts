// Editing a category definition. The server validates for real; these helpers build well-formed
// pieces so the editor cannot send nonsense, and give the form quick feedback.

import type { AttributeDef, AttrKind, CategorySchema, CriterionDef } from "../api/types";

/** `Battery life (h)` -> `battery_life_h`. */
export function slugKey(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function uniqueKey(base: string, taken: string[]): string {
  const root = slugKey(base) || "item";
  if (!taken.includes(root)) return root;
  for (let i = 2; ; i += 1) if (!taken.includes(`${root}_${i}`)) return `${root}_${i}`;
}

export function newCategory(name: string, extendsId: string | null): CategorySchema {
  const id = slugKey(name).replace(/^(\d)/, "c_$1") || "category";
  return {
    id,
    name: name.trim(),
    kind: "product",
    extends: extendsId,
    keywords: [name.trim().toLowerCase()],
    attributes: [],
    criteria: [],
  };
}

export function addAttribute(schema: CategorySchema, label: string, kind: AttrKind, unit?: string): { schema: CategorySchema; key: string } {
  const taken = (schema.attributes ?? []).map((a) => a.key);
  const key = uniqueKey(label, taken);
  const def: AttributeDef = { key, label: label.trim(), kind, unit: unit?.trim() || undefined, aliases: [] };
  return { schema: { ...schema, attributes: [...(schema.attributes ?? []), def] }, key };
}

/** Another name pages use for the attribute: the crawler then files that spec under it. */
export function addAlias(schema: CategorySchema, key: string, alias: string): CategorySchema {
  const a = alias.trim();
  if (!a) return schema;
  return {
    ...schema,
    attributes: (schema.attributes ?? []).map((d) =>
      d.key === key && !(d.aliases ?? []).some((x) => x.toLowerCase() === a.toLowerCase()) ? { ...d, aliases: [...(d.aliases ?? []), a] } : d,
    ),
  };
}

export type CriterionTemplate =
  | { kind: "number"; attribute: string; min: number; max: number; higherIsBetter: boolean }
  | { kind: "flag"; attribute: string }
  | { kind: "formula"; expr: string; min: number; max: number; higherIsBetter: boolean }
  | { kind: "match"; attribute: string; preference: string };

export function addCriterion(schema: CategorySchema, label: string, t: CriterionTemplate, weight = 1): { schema: CategorySchema; key: string } {
  const key = uniqueKey(label, (schema.criteria ?? []).map((c) => c.key));
  let def: CriterionDef;
  switch (t.kind) {
    case "number":
      def = { key, label: label.trim(), kind: "number", attribute: t.attribute, weight, higher_is_better: t.higherIsBetter, scale: { type: "fixed", min: t.min, max: t.max } };
      break;
    case "formula":
      def = { key, label: label.trim(), kind: "formula", expr: t.expr.trim(), weight, higher_is_better: t.higherIsBetter, scale: { type: "fixed", min: t.min, max: t.max } };
      break;
    case "flag":
      def = { key, label: label.trim(), kind: "flag", attribute: t.attribute, weight };
      break;
    case "match":
      def = { key, label: label.trim(), kind: "match", attribute: t.attribute, preference: t.preference, weight };
      break;
  }
  return { schema: { ...schema, criteria: [...(schema.criteria ?? []), def] }, key };
}

export function removeCriterion(schema: CategorySchema, key: string): CategorySchema {
  return { ...schema, criteria: (schema.criteria ?? []).filter((c) => c.key !== key), remove: [...(schema.remove ?? []), key] };
}

export function setCriterionWeight(schema: CategorySchema, key: string, weight: number): CategorySchema {
  return { ...schema, criteria: (schema.criteria ?? []).map((c) => (c.key === key ? { ...c, weight } : c)) };
}

/**
 * A quick local check of a formula, for the form. It catches the usual typing mistakes
 * (unbalanced brackets, a trailing operator, characters the language does not have); the server
 * checks names and functions.
 */
export function formulaProblem(expr: string): string | null {
  const text = expr.trim();
  if (!text) return "Write a formula, e.g. battery_mah / weight_g";
  if (!/^[A-Za-z0-9_.+\-*/^(),\s]+$/.test(text)) return "Only numbers, names, + - * / ^ and brackets are allowed";
  let depth = 0;
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth < 0) return "A closing bracket has no opening one";
  }
  if (depth !== 0) return "A bracket is not closed";
  if (/[+\-*/^,]\s*$/.test(text)) return "The formula ends with an operator";
  if (/^\s*[*/^,]/.test(text)) return "The formula starts with an operator";
  if (/[*/^+]\s*[*/^]/.test(text)) return "Two operators in a row";
  return null;
}

/** Names usable in a formula: the category's attributes and the offer values. */
export function formulaNames(schema: CategorySchema): string[] {
  return [...(schema.attributes ?? []).filter((a) => (a.kind ?? "number") === "number").map((a) => a.key), "price", "monthly", "upfront", "term_months"];
}
