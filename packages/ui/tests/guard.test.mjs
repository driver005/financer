// Enforces the standing rule (CLAUDE.md): no manual padding, sizes or colours outside the tokens.
//
//  - packages/ui/src: only src/constants/ may hold raw numbers and colours; components read tokens.
//  - the apps and the shopping module: no colours, no `style=`, no StyleSheet, no layout primitives
//    from react-native (View, Text, ...): everything visual comes from @financer/ui.
//
// Add a folder to APP_DIRS when it is moved to the design system.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = resolve(here, "../../..");

const UI_SRC = join(repo, "packages/ui/src");
const UI_ALLOWED = [join(UI_SRC, "constants")];
/** Folders and files that must use only @financer/ui. */
const APP_DIRS = [
  "apps/catalog/src",
  "apps/catalog/index.ts",
  "apps/shopping/src",
  "apps/shopping/index.ts",
  "packages/shopping/src/ui",
  "packages/mail/src/ui",
  // the finance app: its screens (src/app) and the components they are built from
  "apps/mobile/src/app",
  "apps/mobile/src/components",
];

function files(path, out = []) {
  if (!existsSync(path)) return out;
  if (statSync(path).isFile()) return /\.(ts|tsx)$/.test(path) ? [...out, path] : out;
  for (const name of readdirSync(path)) {
    if (name === "node_modules" || name === ".test-build") continue;
    out = files(join(path, name), out);
  }
  return out;
}

/** Lines of code with comments removed, with their numbers. */
function code(path) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line, i) => ({ n: i + 1, text: line.replace(/(^|[^:])\/\/.*$/, "$1") }));
}

function hits(paths, pattern, { skip = () => false } = {}) {
  const found = [];
  for (const p of paths) {
    if (skip(p)) continue;
    for (const { n, text } of code(p)) if (pattern.test(text)) found.push(`${relative(repo, p)}:${n}: ${text.trim()}`);
  }
  return found;
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/;
// a style key followed by a number other than 0 (a percentage string is a layout, not a size)
const KEYS = "padding(?:Top|Right|Bottom|Left|Horizontal|Vertical)?|margin(?:Top|Right|Bottom|Left|Horizontal|Vertical)?|gap|rowGap|columnGap|width|height|minWidth|maxWidth|minHeight|maxHeight|fontSize|lineHeight|letterSpacing|borderRadius|border(?:Top|Right|Bottom|Left)?Width|top|left|right|bottom|elevation|zIndex|opacity|strokeWidth";
const NUMBER = new RegExp(`\\b(?:${KEYS})\\s*[:=]\\s*\\{?\\s*-?(?:[1-9]\\d*|0?\\.\\d+)\\b`);

describe("packages/ui: no raw values outside the constants", () => {
  const ui = files(UI_SRC);
  const skip = (p) => UI_ALLOWED.some((a) => p.startsWith(a));

  it("has no colour literals in components", () => assert.deepEqual(hits(ui, COLOUR, { skip }), []));
  it("has no raw padding, margin, gap, size, radius, font size or opacity in components", () => assert.deepEqual(hits(ui, NUMBER, { skip }), []));
  it("finds the constants, so that this test cannot pass by scanning nothing", () => {
    assert.ok(ui.length > 40, `only ${ui.length} files scanned`);
    assert.ok(ui.some((p) => p.endsWith("constants/palette.ts")));
  });
});

describe("apps and the shopping module: only the design system", () => {
  const app = APP_DIRS.flatMap((d) => files(join(repo, d)));

  it("has no colour literals", () => assert.deepEqual(hits(app, COLOUR), []));
  it("has no raw spacing or sizes", () => assert.deepEqual(hits(app, NUMBER), []));
  it("has no style props and no StyleSheet", () => {
    assert.deepEqual(hits(app, /\bstyle\s*=\s*\{|\bStyleSheet\b/), []);
  });
  it("draws nothing with react-native's own view components", () => {
    const forbidden = "View|Text|Pressable|TextInput|ScrollView|Image|Switch|FlatList|SectionList|ActivityIndicator|Modal|SafeAreaView|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback|KeyboardAvoidingView|Animated";
    const found = [];
    for (const p of app) {
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']react-native["']/g)) {
        const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
        const bad = names.filter((n) => new RegExp(`^(?:${forbidden})$`).test(n));
        if (bad.length) found.push(`${relative(repo, p)}: imports ${bad.join(", ")} from react-native`);
      }
    }
    assert.deepEqual(found, []);
  });
  it("scans something", () => assert.ok(app.length >= 8, `only ${app.length} files scanned`));
});
