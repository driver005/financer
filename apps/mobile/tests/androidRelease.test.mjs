import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { setProperties } = require("../plugins/withAndroidRelease.js");

const get = (items, key) => items.find((i) => i.type === "property" && i.key === key)?.value;

describe("Android release build properties", () => {
  it("turns code shrinking off, which crashed the SDK 58 app on start", () => {
    const out = setProperties([{ type: "property", key: "android.enableMinifyInReleaseBuilds", value: "true" }]);
    assert.equal(get(out, "android.enableMinifyInReleaseBuilds"), "false");
    assert.equal(get(out, "android.enableShrinkResourcesInReleaseBuilds"), "false");
  });

  it("sets each property exactly once and keeps the others", () => {
    const out = setProperties([
      { type: "property", key: "newArchEnabled", value: "true" },
      { type: "comment", value: "x" },
      { type: "property", key: "android.enableMinifyInReleaseBuilds", value: "true" },
      { type: "property", key: "android.enableMinifyInReleaseBuilds", value: "true" },
    ]);
    assert.equal(out.filter((i) => i.key === "android.enableMinifyInReleaseBuilds").length, 1);
    assert.equal(get(out, "newArchEnabled"), "true");
    assert.equal(out.filter((i) => i.type === "comment").length, 1);
  });

  it("is registered in app.json", async () => {
    const { readFile } = await import("node:fs/promises");
    const app = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));
    assert.ok(app.expo.plugins.includes("./plugins/withAndroidRelease"));
  });
});
