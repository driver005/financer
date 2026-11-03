import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MailApiError } from "../src/api/client";
import { fromSdk, SdkMailClient, type MailSdkLike, type SdkModule } from "../src/api/sdk";

// The generated enums are TypeScript numeric enums: members count up from 0 and the object also maps back.
const ConversationKind: Record<string, string | number> = { Person: 0, Topic: 1, 0: "Person", 1: "Topic" };
const TemplateKind: Record<string, string | number> = { Greeting: 0, Closing: 1, 0: "Greeting", 1: "Closing" };

class Auto {}
class None {}
class Id {
  constructor(public inner: { id: bigint }) {}
}

type Call = { method: string; args: unknown[] };

function fake(answers: Record<string, unknown> = {}, fail?: unknown) {
  const calls: Call[] = [];
  const sdk = new Proxy({}, {
    get: (_t, method: string) => async (...args: unknown[]) => {
      calls.push({ method, args });
      if (fail) throw fail;
      return answers[method];
    },
  }) as MailSdkLike;
  let inited = 0;
  const connected: { base?: string; token?: string } = {};
  const module: SdkModule = {
    MailSdk: class {
      constructor(base: string, token: string) {
        Object.assign(connected, { base, token });
        return sdk as never;
      }
    } as never,
    Choice: { Auto, None, Id } as never,
    ConversationKind,
    TemplateKind,
    uniffiInitAsync: async () => void inited++,
  };
  return { calls, module, sdk, connected, inited: () => inited };
}

describe("fromSdk", () => {
  it("turns what Rust sends into what the screens read", () => {
    const sent = {
      conversations: [{ key: "p-1", kind: 0, title: "Max", people: [{ name: "Max", email: "m@x.de" }, { email: "n@x.de" }], count: 3, unread: 1, lastAt: 1793708675n, lastFromMe: false, preview: "Hi", topics: ["A"], automated: false }],
      unreadPeople: 1,
      unreadUpdates: 0,
    };
    assert.deepEqual(fromSdk(sent, ConversationKind), {
      conversations: [{ key: "p-1", kind: "person", title: "Max", people: [{ name: "Max", email: "m@x.de" }, { email: "n@x.de" }], count: 3, unread: 1, last_at: 1793708675, last_from_me: false, preview: "Hi", topics: ["A"], automated: false }],
      unread_people: 1,
      unread_updates: 0,
    });
  });

  it("names template kinds from their own enum and gives absent values as null", () => {
    const out = fromSdk({ id: 7n, kind: 1, name: "VG", text: "VG", fallback: undefined, audience: [], isDefault: true }, TemplateKind) as Record<string, unknown>;
    assert.deepEqual(out, { id: 7, kind: "closing", name: "VG", text: "VG", fallback: null, audience: [], is_default: true });
  });

  it("leaves a kind alone when no enum is given, and plain values as they are", () => {
    assert.deepEqual(fromSdk({ kind: 0, ok: true, s: "x", n: null }), { kind: 0, ok: true, s: "x", n: null });
  });
});

describe("SdkMailClient", () => {
  it("loads the module once and connects with the address and token", async () => {
    const f = fake({ info: { configured: true, timezone: "Europe/Berlin", pollMinutes: 5n, messages: 4n, unread: 1n, syncing: false } });
    const c = await SdkMailClient.connect(f.module, "https://x.example", "tok");
    assert.equal(f.inited(), 1);
    assert.deepEqual(f.connected, { base: "https://x.example", token: "tok" });
    assert.deepEqual(await c.info(), { configured: true, timezone: "Europe/Berlin", poll_minutes: 5, messages: 4, unread: 1, syncing: false });
  });

  it("asks with the filters in the order the SDK takes them", async () => {
    const f = fake({ conversations: { conversations: [], unreadPeople: 0, unreadUpdates: 0 } });
    const c = await SdkMailClient.connect(f.module, "u", "t");
    await c.conversations({ by: "topic", scope: "all", q: "x", limit: 5 });
    await c.conversations();
    assert.deepEqual(f.calls.map((x) => x.args), [["topic", "all", "x", 5], [undefined, undefined, undefined, undefined]]);
  });

  it("gives ids as bigints and the chat as the screens read it", async () => {
    const f = fake({
      conversation: { conversation: { key: "p-1", kind: 1, title: "T", people: [], count: 1, unread: 0, lastAt: 5n, lastFromMe: true, preview: "", topics: [], automated: false }, messages: [{ id: 9n, mine: true, from: { email: "a@b.de" }, to: [], cc: [], at: 5n, subject: "s", topic: "s", text: "hi", trimmed: false, unread: false, events: [] }], replyTo: [], replyToMessage: 9n },
    });
    const c = await SdkMailClient.connect(f.module, "u", "t");
    const chat = (await c.conversation("p-1")) as unknown as { conversation: { kind: string }; messages: { id: number; at: number }[]; reply_to_message: number };
    assert.equal(chat.conversation.kind, "topic");
    assert.deepEqual([chat.messages[0].id, chat.messages[0].at, chat.reply_to_message], [9, 5, 9]);
    await c.message(12);
    await c.removeEvent(3);
    await c.deleteTemplate(4);
    assert.deepEqual(f.calls.slice(1).map((x) => x.args[0]), [12n, 3n, 4n]);
  });

  it("builds greeting and closing choices as the generated enum wants them", async () => {
    const f = fake({ preview: { text: "t", greeting: undefined, closing: { id: 2n, name: "VG", text: "VG" }, warnings: [] } });
    const c = await SdkMailClient.connect(f.module, "u", "t");
    const p = await c.preview({ to: ["a@b.de"], body: "x", greeting: "none", closing: { id: 2 } });
    const sent = f.calls[0].args[0] as { to: string[]; greeting: unknown; closing: Id };
    assert.ok(sent.greeting instanceof None);
    assert.ok(sent.closing instanceof Id && sent.closing.inner.id === 2n);
    assert.deepEqual(p, { text: "t", greeting: null, closing: { id: 2, name: "VG", text: "VG" }, warnings: [] });
    await c.preview({ to: [], body: "", greeting: "auto", closing: "auto" });
    assert.ok((f.calls[1].args[0] as { greeting: unknown }).greeting instanceof Auto);
  });

  it("sends a message with the defaults the SDK needs and a bigint reply id", async () => {
    const f = fake({ send: { id: 1n, messageId: "m", text: "t", warnings: [] } });
    const c = await SdkMailClient.connect(f.module, "u", "t");
    await c.send({ to: ["a@b.de"], body: "hi", greeting: "auto", closing: "auto", reply_to: 8 });
    const sent = f.calls[0].args[0] as Record<string, unknown>;
    assert.deepEqual([sent.to, sent.cc, sent.bcc, sent.subject, sent.body, sent.replyTo], [["a@b.de"], [], [], "", "hi", 8n]);
    await c.send({ to: ["a@b.de"], body: "hi", greeting: "none", closing: "none", reply_to: null });
    assert.equal("replyTo" in (f.calls[1].args[0] as object), false, "no reply id is left out, not sent as null");
  });

  it("sends templates with a kind from the generated enum and ids as bigints", async () => {
    const f = fake({ createTemplate: { id: 3n, kind: 0, name: "N", text: "T", fallback: undefined, audience: [], isDefault: false }, updateTemplate: { id: 3n, kind: 0, name: "M", text: "T", audience: [], isDefault: false } });
    const c = await SdkMailClient.connect(f.module, "u", "t");
    const made = await c.createTemplate({ kind: "greeting", name: "N", text: "T", fallback: null, audience: ["a@b.de"], is_default: false });
    assert.deepEqual(f.calls[0].args[0], { id: 0n, kind: 0, name: "N", text: "T", audience: ["a@b.de"], isDefault: false });
    assert.deepEqual(made, { id: 3, kind: "greeting", name: "N", text: "T", fallback: null, audience: [], is_default: false });
    await c.updateTemplate({ ...made, name: "M" });
    assert.equal((f.calls[1].args[0] as { id: bigint }).id, 3n);
  });

  it("makes events with the all-day flag the SDK requires", async () => {
    const f = fake({ createEvent: { id: 1n, status: "active", uid: "u", title: "Z", start: "2026-11-12T08:30", allDay: false, source: "manual", sequence: 0n, cancelled: false }, events: { from: "a", to: "b", events: [] } });
    const c = await SdkMailClient.connect(f.module, "u", "t");
    await c.createEvent({ title: "Z", start: "2026-11-12T08:30", end: null, location: "Praxis" });
    assert.deepEqual(f.calls[0].args[0], { title: "Z", start: "2026-11-12T08:30", allDay: false, location: "Praxis" });
    await c.events({ from: "2026-11-01", includeCancelled: true });
    assert.deepEqual(f.calls[1].args, ["2026-11-01", undefined, true]);
  });

  it("turns the SDK's error into the screens' error with its reasons", async () => {
    const e = Object.assign(new Error("x"), { inner: { status: 400, message: "The template is not valid.", problems: ["The text is empty."] } });
    const c = await SdkMailClient.connect(fake({}, e).module, "u", "t");
    await assert.rejects(c.templates(), (err: unknown) => {
      assert.ok(err instanceof MailApiError);
      assert.deepEqual([err.status, err.message, err.problems], [400, "The template is not valid.", ["The text is empty."]]);
      return true;
    });
    const net = Object.assign(new Error("net"), { inner: { message: "cannot reach the server: refused" } });
    await assert.rejects((await SdkMailClient.connect(fake({}, net).module, "u", "t")).info(), /cannot reach the server/);
  });
});
