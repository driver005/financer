// A conversation as a list of rows: day dividers, topic dividers and bubbles.

import type { ChatMessage } from "../api/types";
import { clock, dayKey, dayLabel, type Fmt } from "./format";

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

const sameTopic = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function chatRows(messages: ChatMessage[], o: ChatRowOptions): ChatRow[] {
  const f = o.fmt ?? {};
  const today = dayKey(o.now, f);
  const rows: ChatRow[] = [];
  let day = "";
  let topic: string | null = null;
  for (const m of messages) {
    const d = dayKey(m.at, f);
    if (d !== day) {
      day = d;
      rows.push({ kind: "day", key: `day-${d}`, label: dayLabel(d, today, f) });
    }
    if (o.showTopics && m.topic && (topic === null || !sameTopic(topic, m.topic))) {
      rows.push({ kind: "topic", key: `topic-${m.id}`, label: m.topic });
    }
    if (m.topic) topic = m.topic;
    rows.push({ kind: "message", key: `m-${m.id}`, message: m, time: clock(m.at, f), showSender: o.groupChat && !m.mine });
  }
  return rows;
}

/** Ids of the messages not read yet. */
export function unreadIds(messages: ChatMessage[]): number[] {
  return messages.filter((m) => m.unread).map((m) => m.id);
}
