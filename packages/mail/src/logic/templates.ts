// Helpers for the template screens. The rules are in Rust (crates/logic, mail_text.rs).

import { logic } from "../../../wire/src/logic";
import type { Choice, Template, TemplateKind } from "../api/types";

/** The template filled in with an example person and sender. */
export const exampleText = (text: string): string => logic("mail_text.example_text", { text });

/** `["max@x.de", "@firma.de"]` as "max@x.de, @firma.de", or "Anyone". */
export const audienceText = (audience: string[]): string => logic("mail_text.audience_text", { audience });

/** The audience as typed (separated by commas, semicolons, spaces or lines) as a list. */
export const parseAudience = (text: string): string[] => logic("mail_text.parse_audience", { text });

export const templatesOf = (all: Template[], kind: TemplateKind): Template[] => logic("mail_text.templates_of", { all, kind });

export const choiceKey = (c: Choice): string => logic("mail_text.choice_key", { c });

/** What a choice means in words: "Automatic", "None" or the template's name. */
export const choiceLabel = (c: Choice, all: Template[]): string => logic("mail_text.choice_label", { c, all });

/** The first line of a template, for a chip ("Lieber Max," / "VG"). */
export const firstLine = (text: string): string => logic("mail_text.first_line", { text });

export const BLANK_TEMPLATE: Record<TemplateKind, Omit<Template, "id">> = {
  greeting: { kind: "greeting", name: "", text: "Hallo {first_name},", fallback: "Hallo,", audience: [], is_default: false },
  closing: { kind: "closing", name: "", text: "Viele Grüße\n{my_first_name}", fallback: null, audience: [], is_default: false },
};
