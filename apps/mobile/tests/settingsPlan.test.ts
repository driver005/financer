import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SETTINGS_SECTIONS,
  aiSummary,
  blzProblem,
  ibanChecksumOk,
  ibanProblem,
  connectionState,
  habitLabel,
  onCountLabel,
  paydayLabel,
  priceSourcesLabel,
  providerLabel,
  serverHost,
  type ConnectionInput,
} from "../src/settingsPlan";

const base: ConnectionInput = {
  mode: "remote",
  hasConfig: true,
  baseUrl: "https://financer.example.com:8443/api",
  embeddedAvailable: false,
  embeddedError: null,
  settingsLoaded: true,
  settingsError: null,
};

describe("sections", () => {
  it("lists the five sections in order with unique ids", () => {
    assert.deepEqual(
      SETTINGS_SECTIONS.map((s) => s.title),
      ["Account & data", "Money", "Groceries", "Privacy & security", "About"],
    );
    assert.equal(new Set(SETTINGS_SECTIONS.map((s) => s.id)).size, SETTINGS_SECTIONS.length);
  });
});

describe("serverHost", () => {
  it("keeps host and port, drops scheme and path", () => {
    assert.equal(serverHost("https://financer.example.com:8443/api"), "financer.example.com:8443");
    assert.equal(serverHost("  http://192.168.1.5:3000  "), "192.168.1.5:3000");
  });
  it("returns what was typed when it is not an address, and empty for nothing", () => {
    assert.equal(serverHost("not a url"), "not a url");
    assert.equal(serverHost("   "), "");
  });
});

describe("connectionState", () => {
  it("is connected when the settings request answered", () => {
    assert.deepEqual(connectionState(base), { tone: "ok", where: "financer.example.com:8443", status: "Connected" });
  });
  it("says checking while the first request is open", () => {
    assert.equal(connectionState({ ...base, settingsLoaded: false }).tone, "warn");
  });
  it("shows the error when the server cannot be reached", () => {
    const s = connectionState({ ...base, settingsLoaded: false, settingsError: "Wrong or missing API token" });
    assert.equal(s.tone, "bad");
    assert.match(s.status, /Wrong or missing API token/);
  });
  it("is off without a saved server", () => {
    const s = connectionState({ ...base, hasConfig: false, baseUrl: undefined, settingsLoaded: false });
    assert.deepEqual(s, { tone: "off", where: "Server", status: "Not connected yet" });
  });
  it("reports the on-phone backend: missing, failing, running", () => {
    const phone = { ...base, mode: "embedded" as const };
    assert.equal(connectionState(phone).tone, "bad");
    assert.equal(connectionState({ ...phone, embeddedAvailable: true, embeddedError: "boom" }).status, "boom");
    assert.deepEqual(connectionState({ ...phone, embeddedAvailable: true }), { tone: "ok", where: "This phone", status: "Running inside this app" });
  });
});

describe("bank form hints", () => {
  it("wants 8 digits for the bank code", () => {
    assert.equal(blzProblem(""), null);
    assert.equal(blzProblem("12345678"), null);
    assert.match(blzProblem("1234") ?? "", /8 digits/);
    assert.match(blzProblem("1234567a") ?? "", /8 digits/);
  });
  it("checks the IBAN check digits, ignoring spaces and case", () => {
    assert.equal(ibanChecksumOk("DE89 3704 0044 0532 0130 00"), true);
    assert.equal(ibanChecksumOk("de89370400440532013000"), true);
    assert.equal(ibanChecksumOk("DE89370400440532013001"), false);
    assert.equal(ibanChecksumOk("123"), false);
    assert.equal(ibanProblem(""), null);
    assert.equal(ibanProblem("DE89 3704 0044 0532 0130 00"), null);
    assert.match(ibanProblem("DE00 3704 0044 0532 0130 00") ?? "", /check digits/);
  });
});

describe("labels", () => {
  it("names the habit modes and providers, passing unknown values through", () => {
    assert.equal(habitLabel("manual"), "My own list");
    assert.equal(habitLabel("receipts"), "Receipts");
    assert.equal(habitLabel("spending"), "Estimate from spending");
    assert.equal(habitLabel("other"), "other");
    assert.equal(providerLabel("open_ai"), "OpenAI");
    assert.equal(providerLabel("x"), "x");
  });
  it("summarises the AI setting", () => {
    assert.equal(aiSummary("claude", true, ""), "Claude · key set");
    assert.equal(aiSummary("open_ai", false, " gpt-x "), "OpenAI · no key · gpt-x");
  });
  it("counts price sources and switches", () => {
    assert.equal(priceSourcesLabel(0), "No price sources");
    assert.equal(priceSourcesLabel(1), "1 price source");
    assert.equal(priceSourcesLabel(3), "3 price sources");
    assert.equal(onCountLabel(2, 3), "2 of 3 on");
  });
  it("labels the payday", () => {
    assert.equal(paydayLabel(1), "Calendar month");
    assert.equal(paydayLabel(25), "Day 25");
  });
});
