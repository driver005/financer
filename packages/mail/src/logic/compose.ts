// Rules of the compose screens that do not need the screen. They are in Rust (crates/logic, mail_text.rs).

import { logic } from "../../../wire/src/logic";
import type { Address } from "../api/types";

/** The words for a person: their name, else their address. */
export const personName = (a: Address): string => logic("mail_text.person_name", { a });

/** "Max, Anna & Tom". */
export const peopleText = (list: Address[]): string => logic("mail_text.people_text", { list });

/** The recipients as the server wants them: one string per address, name kept. */
export const recipientStrings = (list: Address[]): string[] => logic("mail_text.recipient_strings", { list });

/** Whether a message can be sent: someone to send to, something to say, and a subject for a new topic. */
export const sendProblem = (o: { to: string; body: string; subject: string; isReply: boolean }): string | null =>
  logic("mail_text.send_problem", { to: o.to, body: o.body, subject: o.subject, is_reply: o.isReply });

/** Newest first becomes oldest first: the order a chat is read in. */
export const oldestFirst = <T extends { at: number }>(list: T[]): T[] => logic("mail_text.oldest_first", { list });
