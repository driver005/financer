import assert from "node:assert/strict";
import { test } from "node:test";

import { bind, CallError, readRefusal, type App } from "../src/index";

function wire(answer: (app: App, op: string, args: string) => Promise<string>) {
  return { call: answer };
}

test("an answer is the server's JSON, and null means nothing", async () => {
  const seen: unknown[] = [];
  const caller = bind(
    wire(async (app, op, args) => {
      seen.push([app, op, JSON.parse(args)]);
      return op === "delete_thing" ? "null" : '{"id":3,"note":null}';
    }),
    "finance",
  );
  assert.deepEqual(await caller.call("get_thing", { id: 3 }), { id: 3, note: null });
  assert.equal(await caller.call("delete_thing", { id: 3 }), undefined);
  assert.deepEqual(seen[0], ["finance", "get_thing", { id: 3 }]);
  assert.deepEqual(seen[1], ["finance", "delete_thing", { id: 3 }]);
  assert.deepEqual(await bind(wire(async () => "{}"), "shop").call("info"), {});
});

test("a refusal keeps its status, its words and its problems, in the class the screens know", async () => {
  class Mine extends CallError {}
  const refuse = Object.assign(new Error("Api"), { inner: { status: 422, message: "not valid", problems: ["a", "b"] } });
  const caller = bind(wire(() => Promise.reject(refuse)), "mail", Mine);
  await assert.rejects(caller.call("send", {}), (e: Mine) => e instanceof Mine && e.status === 422 && e.message === "not valid" && e.problems.join() === "a,b");
});

test("not reaching the server is status 0 with the words it came with", async () => {
  const offline = Object.assign(new Error("Network"), { inner: { message: "cannot reach the server: refused" } });
  const caller = bind(wire(() => Promise.reject(offline)), "finance");
  await assert.rejects(caller.call("x"), (e: CallError) => e.status === 0 && /cannot reach/.test(e.message));
  assert.deepEqual(readRefusal(new Error("plain")), { status: 0, message: "plain", problems: [] });
});
