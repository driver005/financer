// Watches over the finance app's design: fails when a change breaks a rule that the look depends
// on. What a screen may contain (no raw spacing, sizes or colours, no style props, nothing from
// react-native but behaviour) is enforced by packages/ui/tests/guard.test.mjs; these are the rules
// that are about this app's own screens.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

const SRC = "src";

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

const sources = files(SRC).map((path) => ({ path: relative(SRC, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }));

/** Lines of code (comments dropped) where `pattern` matches, as `file:line: text`. */
function hits(pattern, { except = [] } = {}) {
  const found = [];
  for (const { path, text } of sources) {
    if (except.includes(path)) continue;
    text.split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
      if (/^\s*\*/.test(line)) return; // inside a block comment
      if (pattern.test(code)) found.push(`${path}:${i + 1}: ${line.trim()}`);
    });
  }
  return found;
}

describe("design guard", () => {
  it("labels are in sentence case, not capitals", () => {
    assert.deepEqual(hits(/textTransform:\s*["']uppercase["']|\.toUpperCase\(\)/), []);
  });

  it("emoji are game content (mascot, badges, trophies, quests), never interface icons", () => {
    // the interface uses vector icons; emoji live only where they ARE the content
    const allowed = ["components/TrophiesCard.tsx", "app/trophies.tsx", "app/index.tsx"];
    assert.deepEqual(hits(/\p{Extended_Pictographic}/u, { except: allowed }), []);
  });

  it("every screen is a Page (title bar, Settings button or back button, safe areas)", () => {
    const bare = sources
      .filter((s) => s.path.startsWith("app/") && !s.path.startsWith("app/_") && !s.path.startsWith("app/+"))
      .filter((s) => !/<Page\b/.test(s.text) && !/<Redirect/.test(s.text))
      // setup has its own frame, the shopping assistant is a module with its own screens (src/shop)
      .filter((s) => s.path !== "app/shop.tsx" && s.path !== "app/onboarding.tsx")
      .map((s) => s.path);
    assert.deepEqual(bare, []);
  });

  it("nothing draws with the old kit, HeroUI or utility classes any more", () => {
    assert.deepEqual(hits(/from "@\/components\/(ui|kit|panel|rows)"|from "heroui-native"|className=/), []);
  });
});
