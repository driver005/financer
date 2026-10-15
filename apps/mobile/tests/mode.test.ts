import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { initialMode, isSetUp } from "../src/api/mode";

describe("which backend the app starts on", () => {
  it("a fresh compact build starts on the phone, but that is not a choice yet", () => {
    assert.deepEqual(initialMode({ storedMode: null, hasServer: false, embeddedAvailable: true }), { mode: "embedded", chosen: false });
  });

  it("a fresh client build or web build starts on a server", () => {
    assert.deepEqual(initialMode({ storedMode: null, hasServer: false, embeddedAvailable: false }), { mode: "remote", chosen: false });
  });

  it("a saved server beats the compact default (an update must not move someone off their server)", () => {
    assert.deepEqual(initialMode({ storedMode: null, hasServer: true, embeddedAvailable: true }), { mode: "remote", chosen: false });
  });

  it("a saved mode is a choice and wins", () => {
    assert.deepEqual(initialMode({ storedMode: "embedded", hasServer: false, embeddedAvailable: true }), { mode: "embedded", chosen: true });
    assert.deepEqual(initialMode({ storedMode: "embedded", hasServer: true, embeddedAvailable: false }), { mode: "embedded", chosen: true });
    assert.deepEqual(initialMode({ storedMode: "remote", hasServer: false, embeddedAvailable: true }), { mode: "remote", chosen: true });
  });
});

describe("whether the first-run setup is skipped", () => {
  it("shows the setup on a fresh compact build, even though it starts on the phone", () => {
    const start = initialMode({ storedMode: null, hasServer: false, embeddedAvailable: true });
    assert.equal(isSetUp({ hasServer: false, ...start }), false);
  });

  it("skips it once on-phone mode was chosen or a server is saved", () => {
    assert.equal(isSetUp({ hasServer: false, mode: "embedded", chosen: true }), true);
    assert.equal(isSetUp({ hasServer: true, mode: "remote", chosen: false }), true);
  });

  it("does not treat a remote mode without a server as set up", () => {
    assert.equal(isSetUp({ hasServer: false, mode: "remote", chosen: true }), false);
  });
});
