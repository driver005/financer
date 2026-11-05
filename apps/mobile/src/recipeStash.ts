// A generated idea has no id on the server, so the page that lists it leaves it here for the page
// that opens it. Plain data; nothing is stored beyond the running app.
import type { Idea } from "@/api/client";

export const IDEA_ID = "idea";

let stashed: Idea | null = null;

export function stashIdea(idea: Idea): void {
  stashed = idea;
}

export function stashedIdea(): Idea | null {
  return stashed;
}
