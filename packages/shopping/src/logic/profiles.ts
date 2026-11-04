// Saved priorities: the profiles stored under a name ("default" is the one searches use). The rules are
// in Rust (crates/logic, shop_misc.rs); the ordering stays here because it sorts the way the device's
// language does.

import { logic } from "../../../wire/src/logic";
import type { Profile } from "../api/types";

export const DEFAULT_PROFILE = "default";

/** What a profile asks for, in a few words: "3 priorities, 2 wishes, under 600 €, new only". */
export const profileSummary = (p: Profile): string => logic("shop_misc.profile_summary", { p });

/** A name for a copy: trimmed, one line, not "default" and not one already in use; a problem in words otherwise. */
export const profileNameProblem = (name: string, existing: string[]): string | null => logic("shop_misc.profile_name_problem", { name, existing });

/** The profiles with the one searches use first, then by name. */
export function orderProfiles<T extends { name: string }>(all: T[]): T[] {
  return [...all].sort((a, b) => (a.name === DEFAULT_PROFILE ? -1 : b.name === DEFAULT_PROFILE ? 1 : a.name.localeCompare(b.name)));
}
