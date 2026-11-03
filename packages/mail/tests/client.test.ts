import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MailApiError, MailClient } from "../src/api/client";
import { RemoteMailTransport, type MailRequest, type MailResponse, type MailTransport } from "../src/api/transport";

class Fake implements MailTransport {
  requests: MailRequest[] = [];
  constructor(private reply: MailResponse = { status: 200, text: "{}" }) {}
  async send(req: MailRequest): Promise<MailResponse> {
    this.requests.push(req);
    return this.reply;
  }
}

const json = (status: number, body: unknown): MailResponse => ({ status, text: JSON.stringify(body) });

describe("MailClient", () => {
  it("asks for conversations with the filters in the query", async () => {
    const t = new Fake(json(200, { conversations: [], unread_people: 0, unread_updates: 0 }));
    const c = new MailClient(t);
    await c.conversations();
    await c.conversations({ by: "topic", scope: "all", q: "  Fußball ", limit: 20 });
    assert.deepEqual(t.requests.map((r) => [r.method, r.path]), [
      ["GET", "/v1/mail/conversations"],
      ["GET", "/v1/mail/conversations?by=topic&scope=all&q=Fu%C3%9Fball&limit=20"],
    ]);
    assert.equal(t.requests[0].body, undefined);
    assert.equal(t.requests[0].headers, undefined);
  });

  it("sends JSON bodies with a content type", async () => {
    const t = new Fake(json(201, { id: 1, message_id: "x", text: "t", warnings: [] }));
    await new MailClient(t).send({ to: ["max@x.de"], body: "Hi", greeting: "auto", closing: { id: 4 } });
    const r = t.requests[0];
    assert.deepEqual([r.method, r.path], ["POST", "/v1/mail/send"]);
    assert.equal(r.headers?.["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(r.body!), { to: ["max@x.de"], body: "Hi", greeting: "auto", closing: { id: 4 } });
  });

  it("escapes the conversation key and builds the other paths", async () => {
    const t = new Fake({ status: 204, text: "" });
    const c = new MailClient(t);
    await c.markRead("p-ab/cd");
    await c.removeEvent(7);
    await c.deleteTemplate(3);
    await c.events({ from: "2026-11-01", to: "2026-11-30", includeCancelled: true });
    await c.events();
    assert.deepEqual(t.requests.map((r) => `${r.method} ${r.path}`), [
      "POST /v1/mail/conversations/p-ab%2Fcd/read",
      "DELETE /v1/mail/events/7",
      "DELETE /v1/mail/templates/3",
      "GET /v1/mail/events?from=2026-11-01&to=2026-11-30&include_cancelled=true",
      "GET /v1/mail/events",
    ]);
  });

  it("returns nothing for 204", async () => {
    assert.equal(await new MailClient(new Fake({ status: 204, text: "" })).deleteTemplate(1), undefined);
  });

  it("turns the server's error into an exception with its problems", async () => {
    const c = new MailClient(new Fake(json(400, { error: "The template is not valid.", problems: ["The text is empty.", "x"] })));
    await assert.rejects(c.createTemplate({ kind: "closing", name: "", text: "", fallback: null, audience: [], is_default: false }), (e: unknown) => {
      assert.ok(e instanceof MailApiError);
      assert.equal(e.status, 400);
      assert.equal(e.message, "The template is not valid.");
      assert.deepEqual(e.problems, ["The text is empty.", "x"]);
      return true;
    });
  });

  it("explains an answer that is not the server's JSON", async () => {
    await assert.rejects(new MailClient(new Fake({ status: 401, text: "" })).info(), /did not accept the token/);
    await assert.rejects(new MailClient(new Fake({ status: 404, text: "" })).info(), /no mail client/);
    await assert.rejects(new MailClient(new Fake({ status: 502, text: "bad gateway" })).info(), /bad gateway/);
    await assert.rejects(new MailClient(new Fake({ status: 500, text: "x".repeat(500) })).info(), /request failed \(500\)/);
  });
});

describe("RemoteMailTransport", () => {
  it("sends the bearer token to the configured address", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const t = new RemoteMailTransport({ baseUrl: "https://example.org/", token: "secret-token" }, (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return { status: 200, text: async () => "{}" };
    }) as never);
    const res = await t.send({ method: "GET", path: "/v1/mail/info" });
    assert.equal(res.status, 200);
    assert.equal(seen[0].url, "https://example.org/v1/mail/info");
    assert.deepEqual(seen[0].init.headers, { Authorization: "Bearer secret-token" });
  });
});
