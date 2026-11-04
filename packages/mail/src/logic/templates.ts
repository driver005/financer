// Helpers for the template screens.

import type { Choice, Template, TemplateKind } from "../api/types";

/** Names used to show what a template looks like before it is used. */
const EXAMPLE: Record<string, string> = {
  first_name: "Max",
  last_name: "Müller",
  name: "Max Müller",
  me: "Paul Meier",
  my_first_name: "Paul",
};

/** The template filled in with an example person and sender. */
export function exampleText(text: string): string {
  return text.replace(/\{([a-z_]+)\}/g, (whole, key: string) => EXAMPLE[key] ?? whole);
}

/** `["max@x.de", "@firma.de"]` as "max@x.de, @firma.de", or "Anyone". */
export function audienceText(audience: string[]): string {
  return audience.length === 0 ? "Anyone" : audience.join(", ");
}

/** The audience as typed (separated by commas, semicolons, spaces or lines) as a list. */
export function parseAudience(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const a = part.trim().toLowerCase();
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

export function templatesOf(all: Template[], kind: TemplateKind): Template[] {
  return all.filter((t) => t.kind === kind);
}

export function choiceKey(c: Choice): string {
  return c === "auto" || c === "none" ? c : `id:${c.id}`;
}

/** What a choice means in words: "Automatic", "None" or the template's name. */
export function choiceLabel(c: Choice, all: Template[]): string {
  if (c === "auto") return "Automatic";
  if (c === "none") return "None";
  return all.find((t) => t.id === c.id)?.name ?? "Chosen template";
}

/** The first line of a template, for a chip ("Lieber Max," / "VG"). */
export function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? "";
}

export const BLANK_TEMPLATE: Record<TemplateKind, Omit<Template, "id">> = {
  greeting: { kind: "greeting", name: "", text: "Hallo {first_name},", fallback: "Hallo,", audience: [], is_default: false },
  closing: { kind: "closing", name: "", text: "Viele Grüße\n{my_first_name}", fallback: null, audience: [], is_default: false },
};
