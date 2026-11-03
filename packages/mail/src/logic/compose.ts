// Rules of the compose screens that do not need the screen.

import type { Address } from "../api/types";

/** The words for a person: their name, else their address. */
export function personName(a: Address): string {
  return a.name?.trim() || a.email;
}

/** "Max, Anna & Tom". */
export function peopleText(list: Address[]): string {
  const names = list.map(personName);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** The recipients as the server wants them: one string per address, name kept. */
export function recipientStrings(list: Address[]): string[] {
  return list.map((a) => (a.name ? `${a.name.includes(",") ? `"${a.name}"` : a.name} <${a.email}>` : a.email));
}

/** Whether a message can be sent: someone to send to, something to say, and a subject for a new topic. */
export function sendProblem(o: { to: string; body: string; subject: string; isReply: boolean }): string | null {
  if (!o.to.trim()) return "Add who it goes to.";
  if (!o.body.trim()) return "Write something first.";
  if (!o.isReply && !o.subject.trim()) return "A new topic needs a subject.";
  return null;
}

/** Newest first becomes oldest first: the order a chat is read in. */
export function oldestFirst<T extends { at: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.at - b.at);
}
