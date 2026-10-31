import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  MAX_BUILD,
  deriveBuildNumber,
  parseBuildNumber,
  parseVersion,
  stampAppJson,
  stampPackageJson,
  stampPackageLock,
  toJson,
} from "../scripts/version-lib.mjs";

describe("parseVersion", () => {
  it("accepts a tag with or without the v", () => {
    assert.deepEqual(parseVersion("v1.2.3"), { major: 1, minor: 2, patch: 3, version: "1.2.3" });
    assert.equal(parseVersion("10.0.7").version, "10.0.7");
    assert.equal(parseVersion(" v0.1.0\n").version, "0.1.0");
  });

  it("normalises leading zeros", () => {
    assert.equal(parseVersion("v1.02.003").version, "1.2.3");
  });

  it("rejects anything that is not MAJOR.MINOR.PATCH", () => {
    for (const bad of ["", "v1", "v1.2", "v1.2.3.4", "v1.2.3-rc1", "1.2.x", "latest", "v-1.2.3", undefined, null]) {
      assert.throws(() => parseVersion(bad), /not a version tag/, String(bad));
    }
  });
});

describe("deriveBuildNumber", () => {
  it("encodes major, minor and patch in decimal groups", () => {
    assert.equal(deriveBuildNumber(parseVersion("v1.2.3")), 1002003);
    assert.equal(deriveBuildNumber(parseVersion("v0.1.0")), 1000);
    assert.equal(deriveBuildNumber(parseVersion("v12.34.56")), 12034056);
  });

  it("only goes up as the version goes up", () => {
    const order = ["0.1.0", "0.1.1", "0.1.999", "0.2.0", "0.999.999", "1.0.0", "1.0.1", "2.0.0", "2099.999.999"];
    const builds = order.map((v) => deriveBuildNumber(parseVersion(v)));
    assert.deepEqual([...builds].sort((a, b) => a - b), builds);
    assert.equal(new Set(builds).size, builds.length);
  });

  it("stays within what Android accepts", () => {
    assert.ok(deriveBuildNumber(parseVersion("2099.999.999")) <= MAX_BUILD);
    assert.throws(() => deriveBuildNumber(parseVersion("2101.0.0")), /too large/);
    assert.throws(() => deriveBuildNumber(parseVersion("1.1000.0")), /below 1000/);
    assert.throws(() => deriveBuildNumber(parseVersion("1.0.1000")), /below 1000/);
  });
});

describe("parseBuildNumber", () => {
  it("takes a positive whole number", () => {
    assert.equal(parseBuildNumber("42"), 42);
    assert.equal(parseBuildNumber(7), 7);
  });

  it("rejects the rest", () => {
    for (const bad of ["0", "-1", "1.5", "abc", "", "99999999999"]) assert.throws(() => parseBuildNumber(bad), undefined, bad);
  });
});

describe("stamping", () => {
  const app = { expo: { name: "Financer", version: "1.0.0", android: { package: "app.financer.mobile" }, ios: { bundleIdentifier: "app.financer.mobile" } } };

  it("sets the version and both build numbers, keeping everything else", () => {
    const out = stampAppJson(app, "1.2.3", 1002003);
    assert.equal(out.expo.version, "1.2.3");
    assert.equal(out.expo.android.versionCode, 1002003);
    assert.equal(out.expo.android.package, "app.financer.mobile");
    assert.equal(out.expo.ios.buildNumber, "1002003"); // iOS wants a string
    assert.equal(out.expo.ios.bundleIdentifier, "app.financer.mobile");
    assert.equal(out.expo.name, "Financer");
  });

  it("does not change its input", () => {
    stampAppJson(app, "9.9.9", 9);
    assert.equal(app.expo.version, "1.0.0");
    assert.equal(app.expo.android.versionCode, undefined);
  });

  it("works when app.json has no android or ios section", () => {
    const out = stampAppJson({ expo: { name: "x" } }, "1.0.0", 1000000);
    assert.equal(out.expo.android.versionCode, 1000000);
    assert.equal(out.expo.ios.buildNumber, "1000000");
  });

  it("stamps package.json and the lock file's root entries only", () => {
    assert.equal(stampPackageJson({ name: "a", version: "1.0.0" }, "2.0.0").version, "2.0.0");
    const lock = { name: "a", version: "1.0.0", packages: { "": { name: "a", version: "1.0.0" }, "node_modules/x": { version: "1.0.0" } } };
    const out = stampPackageLock(lock, "2.0.0");
    assert.equal(out.version, "2.0.0");
    assert.equal(out.packages[""].version, "2.0.0");
    assert.equal(out.packages["node_modules/x"].version, "1.0.0");
    assert.equal(stampPackageLock({ version: "1.0.0" }, "2.0.0").version, "2.0.0"); // no packages map
  });
});

describe("the command line", () => {
  // Run a copy of the script in a scratch directory laid out like apps/mobile.
  function scratch() {
    const dir = mkdtempSync(join(tmpdir(), "set-version-"));
    mkdirSync(join(dir, "scripts"));
    for (const f of ["set-version.mjs", "version-lib.mjs"]) copyFileSync(new URL(`../scripts/${f}`, import.meta.url), join(dir, "scripts", f));
    for (const f of ["app.json", "package.json", "package-lock.json"]) copyFileSync(new URL(`../${f}`, import.meta.url), join(dir, f));
    return dir;
  }
  const run = (dir, ...args) => spawnSync(process.execPath, [join(dir, "scripts", "set-version.mjs"), ...args], { encoding: "utf8" });
  const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), "utf8"));

  it("stamps another app's folder with --dir (apps/shopping uses this script)", () => {
    const script = scratch();
    const other = mkdtempSync(join(tmpdir(), "set-version-other-"));
    try {
      for (const f of ["app.json", "package.json", "package-lock.json"]) copyFileSync(new URL(`../../shopping/${f}`, import.meta.url), join(other, f));
      const r = run(script, "v7.8.9", "--dir", other);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(read(other, "app.json").expo.version, "7.8.9");
      assert.equal(read(other, "app.json").expo.slug, "financer-shop");
      assert.equal(read(other, "package.json").version, "7.8.9");
      assert.notEqual(read(script, "app.json").expo.version, "7.8.9");
    } finally {
      rmSync(script, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("stamps the three files from a tag", () => {
    const dir = scratch();
    try {
      const r = run(dir, "v3.4.5");
      assert.equal(r.status, 0, r.stderr);
      assert.equal(read(dir, "app.json").expo.version, "3.4.5");
      assert.equal(read(dir, "app.json").expo.android.versionCode, 3004005);
      assert.equal(read(dir, "app.json").expo.ios.buildNumber, "3004005");
      assert.equal(read(dir, "package.json").version, "3.4.5");
      assert.equal(read(dir, "package-lock.json").packages[""].version, "3.4.5");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("takes an explicit build number in either position", () => {
    const dir = scratch();
    try {
      assert.equal(run(dir, "--build", "77", "v1.0.1").status, 0);
      assert.equal(read(dir, "app.json").expo.android.versionCode, 77);
      assert.equal(run(dir, "v1.0.2", "--build", "78").status, 0);
      assert.equal(read(dir, "app.json").expo.ios.buildNumber, "78");
      assert.equal(read(dir, "package.json").version, "1.0.2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes nothing with --dry-run and fails on a bad tag", () => {
    const dir = scratch();
    try {
      const before = readFileSync(join(dir, "app.json"), "utf8");
      assert.equal(run(dir, "v9.9.9", "--dry-run").status, 0);
      assert.equal(readFileSync(join(dir, "app.json"), "utf8"), before);
      const bad = run(dir, "main");
      assert.notEqual(bad.status, 0);
      assert.match(bad.stderr, /not a version tag/);
      assert.equal(readFileSync(join(dir, "app.json"), "utf8"), before);
      assert.notEqual(run(dir).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the repository's own files", () => {
  it("are written back byte for byte when the version does not change", () => {
    for (const name of ["app.json", "package.json", "package-lock.json"]) {
      const text = readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
      assert.equal(toJson(JSON.parse(text)), text, name);
    }
  });

  it("app.json and package.json agree on the version", () => {
    const app = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(app.expo.version, pkg.version);
  });
});
