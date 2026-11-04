// A conversation as a list of rows: day dividers, topic dividers and bubbles. The rules are in Rust
// (crates/logic, mail_format.rs).

import { logic } from "../../../wire/src/logic";
import type { ChatMessage } from "../api/types";
import { packOf, zoneOf, type Fmt } from "./format";

export type ChatRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "topic"; key: string; label: string }
  | { kind: "message"; key: string; message: ChatMessage; time: string; showSender: boolean };

export type ChatRowOptions = {
  /** The current instant (seconds), to say Today and Yesterday. */
  now: number;
  fmt?: Fmt;
  /** Mark where the subject changes (a person's chat, not a single topic). */
  showTopics: boolean;
  /** A chat with several people: show who said it. */
  groupChat: boolean;
};

export const chatRows = (messages: ChatMessage[], o: ChatRowOptions): ChatRow[] => {
  const f = o.fmt ?? {};
  return logic("mail_format.chat_rows", { messages, now: o.now, zone: zoneOf(f), pack: packOf(f), show_topics: o.showTopics, group_chat: o.groupChat });
};

/** Ids of the messages not read yet. */
export const unreadIds = (messages: ChatMessage[]): number[] => logic("mail_format.unread_ids", { messages });
