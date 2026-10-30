// Watches over the design: fails when a change breaks a rule the app's look depends on, so a
// regression shows up in CI instead of on someone's phone. The rules are the ones the design pass
// settled on (docs/UI_DESIGN.md). Each rule lists its few, deliberate exceptions.
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
  it("colours come from the palette, not hex literals", () => {
    // ScanFrame draws over the camera picture, SettingsKit owns the red of destructive buttons
    const found = hits(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/, { except: ["components/grocery/ScanFrame.tsx", "components/settings/SettingsKit.tsx", "groceryView.ts"] });
    assert.deepEqual(found, []);
  });

  it("labels are in sentence case, not capitals", () => {
    assert.deepEqual(hits(/textTransform:\s*["']uppercase["']|\.toUpperCase\(\)/), []);
  });

  it("borders are hairlines (1), except on inputs, the mascot and the scan frame", () => {
    const found = hits(/borderWidth:\s*[2-9]\b/, { except: ["components/kit.tsx", "components/Mascot.tsx", "components/grocery/ScanFrame.tsx"] });
    assert.deepEqual(found, []);
  });

  it("buttons are flat: no 3D lip under them", () => {
    assert.deepEqual(hits(/borderBottomWidth:\s*[3-9]\b/, { except: ["components/Mascot.tsx", "components/grocery/ScanFrame.tsx"] }), []);
  });

  it("no text under 12 points", () => {
    assert.deepEqual(hits(/fontSize:\s*([0-9]|1[01])\b/), []);
  });

  it("emoji are game content (mascot, badges, toasts), never interface icons", () => {
    // Today's pills and the forecast use vector icons; emoji live only where they ARE the content
    const allowed = ["components/Mascot.tsx", "components/TrophiesCard.tsx", "components/onboarding/Frame.tsx", "app/trophies.tsx", "app/index.tsx"];
    const found = hits(/\p{Extended_Pictographic}/u, { except: allowed });
    assert.deepEqual(found, []);
  });

  it("screens use the shared Screen and Title, not their own page wrapper", () => {
    const bare = sources
      .filter((s) => s.path.startsWith("app/") && !s.path.startsWith("app/_") && !s.path.startsWith("app/+"))
      .filter((s) => !/<Screen>|<Page\b|<Page>/.test(s.text) && !/<Redirect/.test(s.text))
      .map((s) => s.path);
    assert.deepEqual(bare, []);
  });

  it("every screen shows a Title (it carries the Settings button and the back button)", () => {
    const missing = sources
      .filter((s) => s.path.startsWith("app/") && !s.path.startsWith("app/_") && !s.path.startsWith("app/+") && s.path !== "app/onboarding.tsx")
      .filter((s) => !/<Title\b/.test(s.text))
      .map((s) => s.path);
    assert.deepEqual(missing, []);
  });

  it("an accent-filled rounded block is the shared HeroPanel, not a copy", () => {
    // hand-made copies are how the screens drifted apart; the panel lives in components/panel.tsx
    const found = hits(/backgroundColor:\s*p\.accent\b.*borderRadius:\s*(16|radius\.xl)|borderRadius:\s*(16|radius\.xl).*backgroundColor:\s*p\.accent\b/, {
      except: ["components/panel.tsx", "components/today/TodayHero.tsx"],
    });
    assert.deepEqual(found, []);
  });

  it("filled tiles live in the Today overview only", () => {
    const found = hits(/backgroundColor:\s*tint,/, { except: ["components/today/OverviewTiles.tsx"] });
    assert.deepEqual(found, []);
  });
});
