import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, it } from "node:test";

// Reanimated runs the callbacks of useAnimatedStyle / useAnimatedProps / useDerivedValue on the UI
// thread. A plain JavaScript function called from there crashes the app on a phone ("Tried to
// synchronously call a Remote Function ... on the UI Runtime"), while the web build, which has a
// single thread, runs it fine. This found exactly that in the progress ring, on an Android
// emulator. A function called from such a callback must be marked with the "worklet" directive.

const SRC = new URL("../src/", import.meta.url);

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const url = new URL(name + (statSync(new URL(name, dir)).isDirectory() ? "/" : ""), dir);
    if (name.endsWith("/")) continue;
    if (statSync(url).isDirectory()) out.push(...files(url));
    else if (/\.(ts|tsx)$/.test(name)) out.push(url);
  }
  return out;
}

const sources = files(SRC).map((u) => ({ url: u, text: readFileSync(u, "utf8") }));

// functions that carry the directive, anywhere in src
const workletNames = new Set();
for (const { text } of sources) {
  for (const m of text.matchAll(/function\s+([\w$]+)\s*(?:<[^>]*>)?\s*\([^)]*\)[^{]*\{\s*["']worklet["']/g)) workletNames.add(m[1]);
}

const ALLOWED = /^(with(Timing|Spring|Repeat|Sequence|Delay|Decay|Clamp)|interpolate|interpolateColor|runOnJS|runOnUI|scheduleOnRN|scheduleOnUI|Number|String|Boolean|Array|Object)$/;
const KEYWORDS = new Set(["if", "for", "while", "switch", "return", "function", "catch", "typeof"]);

function callbackBodies(text) {
  const out = [];
  for (const m of text.matchAll(/\buse(?:AnimatedStyle|AnimatedProps|DerivedValue|AnimatedReaction|AnimatedScrollHandler)\s*\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      const ch = text[i++];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    out.push({ hook: m[0].replace(/\s*\($/, ""), body: text.slice(start, i - 1), line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}

function offendingCalls(body) {
  const bad = new Set();
  for (const m of body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (KEYWORDS.has(name) || ALLOWED.test(name) || workletNames.has(name)) continue;
    bad.add(name);
  }
  return [...bad];
}

describe("animation callbacks only call worklets", () => {
  it("found the animation hooks it is meant to check", () => {
    const n = sources.reduce((sum, s) => sum + callbackBodies(s.text).length, 0);
    assert.ok(n >= 8, `only ${n} animation callbacks found`);
  });

  it("calls nothing from the UI thread that is not a worklet", () => {
    const problems = [];
    for (const { url, text } of sources) {
      for (const { hook, body, line } of callbackBodies(text)) {
        const bad = offendingCalls(body);
        if (bad.length) problems.push(`${url.pathname.split("/src/")[1]}:${line} ${hook} calls ${bad.join(", ")}`);
      }
    }
    assert.deepEqual(problems, [], `Mark these with the "worklet" directive or compute the value outside the callback:\n${problems.join("\n")}`);
  });

  it("knows the ring helpers need the directive", () => {
    assert.ok(workletNames.has("dashOffset"), "dashOffset (called from the ring's animated props) is not a worklet");
    assert.ok(workletNames.has("clamp01"), "clamp01 (called by dashOffset) is not a worklet");
  });
});
