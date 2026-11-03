import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bind, type App } from "../../wire/src";
import { MailApiError, MailClient } from "../src/api/client";

type Seen = { app: App; op: string; args: Record<string, unknown> };

function fake(answer: (op: string) => string | Error = () => "{}") {
  const log: Seen[] = [];
  const wire = {
    async call(app: App, op: string, args: string) {
      log.push({ app, op, args: JSON.parse(args) });
      const a = answer(op);
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { log, client: new MailClient(bind(wire, "mail", MailApiError)) };
}

const refusal = (status: number, message: string, problems: string[] = []) => Object.assign(new Error("Api"), { inner: { status, message, problems } });

describe("MailClient", () => {
  it("asks for conversations with the filters by name, trimmed and left out when empty", async () => {
    const { client, log } = fake(() => JSON.stringify({ conversations: [], unread_people: 0, unread_updates: 0 }));
    await client.conversations();
    await client.conversations({ by: "topic", scope: "all", q: "  Fußball ", limit: 20 });
    await client.conversations({ q: "   " });
    assert.deepEqual(log.map((l) => [l.app, l.op, l.args]), [
      ["mail", "conversations", {}],
      ["mail", "conversations", { by: "topic", scope: "all", q: "Fußball", limit: 20 }],
      ["mail", "conversations", {}],
    ]);
  });

  it("hands a request over as its body, the greeting and closing as the server reads them", async () => {
    const { client, log } = fake(() => JSON.stringify({ id: 1, message_id: "x", text: "t", warnings: [] }));
    await client.send({ to: ["max@x.de"], body: "Hi", greeting: "auto", closing: { id: 4 } });
    assert.deepEqual(log[0], { app: "mail", op: "send", args: { body: { to: ["max@x.de"], body: "Hi", greeting: "auto", closing: { id: 4 } } } });
  });

  it("names the other calls with their ids and ranges", async () => {
    const { client, log } = fake(() => "null");
    await client.markRead("p-ab/cd");
    await client.removeEvent(7);
    await client.deleteTemplate(3);
    await client.events({ from: "2026-11-01", to: "2026-11-30", includeCancelled: true });
    await client.events();
    await client.message(9);
    await client.restoreEvent(7);
    await client.updateTemplate({ id: 5, kind: "greeting", name: "x", text: "y", priority: 0, zones: [], domains: [], addresses: [] } as never);
    assert.deepEqual(log.map((l) => [l.op, l.args]).slice(0, 7), [
      ["mark_read", { key: "p-ab/cd" }],
      ["remove_event", { id: 7 }],
      ["delete_template", { id: 3 }],
      ["events", { from: "2026-11-01", to: "2026-11-30", include_cancelled: true }],
      ["events", {}],
      ["message", { id: 9 }],
      ["restore_event", { id: 7 }],
    ]);
    assert.equal(log[7].op, "update_template");
  });

  it("a refusal keeps its words and its problems; a missing mail client is explained", async () => {
    const { client } = fake(() => refusal(422, "bad", ["a", "b"]));
    await assert.rejects(
      () => client.preview({ to: [], body: "", greeting: "auto", closing: "auto" }),
      (e: unknown) => e instanceof MailApiError && e.status === 422 && e.problems.join() === "a,b" && e.message === "bad",
    );
    const none = fake(() => refusal(404, "not found"));
    await assert.rejects(
      () => none.client.info(),
      (e: unknown) => e instanceof MailApiError && e.status === 404 && /mail feature/.test(e.message),
    );
  });
});
