import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatMessage } from "../src/api/types";
import { chatRows, unreadIds } from "../src/logic/chat";

const f = { locale: "en-GB", timeZone: "Europe/Berlin" };
const at = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;
const NOW = at(2026, 11, 3, 9);

function msg(id: number, when: number, topic: string, o: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    mine: false,
    from: { name: "Max Müller", email: "max@example.com" },
    to: [],
    cc: [],
    at: when,
    subject: `Re: ${topic}`,
    topic,
    text: `text ${id}`,
    trimmed: false,
    unread: false,
    events: [],
    ...o,
  };
}

const kinds = (rows: ReturnType<typeof chatRows>) => rows.map((r) => (r.kind === "message" ? `m${r.message.id}` : `${r.kind}:${r.label}`));

describe("chatRows", () => {
  it("puts a day divider before the first message of each day", () => {
    const rows = chatRows([msg(1, at(2026, 11, 2, 17), "A"), msg(2, at(2026, 11, 2, 18), "A"), msg(3, at(2026, 11, 3, 7), "A")], { now: NOW, fmt: f, showTopics: false, groupChat: false });
    assert.deepEqual(kinds(rows), ["day:Yesterday", "m1", "m2", "day:Today", "m3"]);
  });

  it("marks where the topic changes in a person's chat, also at the start", () => {
    const rows = chatRows([msg(1, at(2026, 11, 3, 7), "Fußball"), msg(2, at(2026, 11, 3, 7, 5), "Fußball"), msg(3, at(2026, 11, 3, 8), "Urlaub")], { now: NOW, fmt: f, showTopics: true, groupChat: false });
    assert.deepEqual(kinds(rows), ["day:Today", "topic:Fußball", "m1", "m2", "topic:Urlaub", "m3"]);
  });

  it("does not repeat a topic that differs only in case", () => {
    const rows = chatRows([msg(1, at(2026, 11, 3, 7), "Urlaub"), msg(2, at(2026, 11, 3, 8), "urlaub ")], { now: NOW, fmt: f, showTopics: true, groupChat: false });
    assert.equal(rows.filter((r) => r.kind === "topic").length, 1);
  });

  it("leaves topics out inside a topic", () => {
    const rows = chatRows([msg(1, at(2026, 11, 3, 7), "Urlaub")], { now: NOW, fmt: f, showTopics: false, groupChat: false });
    assert.equal(rows.some((r) => r.kind === "topic"), false);
  });

  it("shows the sender only for other people in a group chat", () => {
    const rows = chatRows([msg(1, at(2026, 11, 3, 7), "A"), msg(2, at(2026, 11, 3, 8), "A", { mine: true })], { now: NOW, fmt: f, showTopics: false, groupChat: true });
    const flags = rows.filter((r) => r.kind === "message").map((r) => (r.kind === "message" ? r.showSender : null));
    assert.deepEqual(flags, [true, false]);
    const single = chatRows([msg(1, at(2026, 11, 3, 7), "A")], { now: NOW, fmt: f, showTopics: false, groupChat: false });
    assert.equal(single.find((r) => r.kind === "message")?.kind === "message" && (single.find((r) => r.kind === "message") as { showSender: boolean }).showSender, false);
  });

  it("writes the time of each bubble in the zone", () => {
    const rows = chatRows([msg(1, at(2026, 11, 3, 7, 5), "A")], { now: NOW, fmt: f, showTopics: false, groupChat: false });
    const m = rows.find((r) => r.kind === "message");
    assert.equal(m?.kind === "message" ? m.time : "", "08:05");
  });

  it("has no rows for no messages, and unique keys otherwise", () => {
    assert.deepEqual(chatRows([], { now: NOW, fmt: f, showTopics: true, groupChat: false }), []);
    const rows = chatRows([msg(1, at(2026, 11, 2, 7), "A"), msg(2, at(2026, 11, 3, 7), "B")], { now: NOW, fmt: f, showTopics: true, groupChat: false });
    assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
  });

  it("lists unread message ids", () => {
    assert.deepEqual(unreadIds([msg(1, 1, "A", { unread: true }), msg(2, 2, "A"), msg(3, 3, "A", { unread: true })]), [1, 3]);
  });
});
