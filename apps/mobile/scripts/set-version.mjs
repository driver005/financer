#!/usr/bin/env node
// Stamp a release version into the app before it is built.
//
//   node scripts/set-version.mjs v1.4.2 [--build N] [--dry-run] [--dir <app folder>]
//
// Sets expo.version, expo.android.versionCode and expo.ios.buildNumber in app.json and the
// version in package.json (and package-lock.json). The build number is derived from the version
// (major * 1000000 + minor * 1000 + patch, so it only goes up) unless --build N is given.
// The release workflow calls it only for version tags. See docs/RELEASE.md.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveBuildNumber,
  parseBuildNumber,
  parseVersion,
  stampAppJson,
  stampPackageJson,
  stampPackageLock,
  toJson,
} from "./version-lib.mjs";

// The app directory (apps/mobile), wherever the script is started from, unless `--dir <path>` names
// another app (apps/shopping uses this script too, so both apps get the same rules).
const dirArg = process.argv.indexOf("--dir");
const root = dirArg >= 0 && process.argv[dirArg + 1] ? resolve(process.argv[dirArg + 1]) : join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(name) {
  return JSON.parse(readFileSync(join(root, name), "utf8"));
}

function main(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const i = args.indexOf("--build");
  const buildArg = i >= 0 ? args[i + 1] : undefined;
  if (i >= 0 && buildArg === undefined) throw new Error("--build needs a number");
  const d = args.indexOf("--dir");
  const tag = args.find((a, j) => !a.startsWith("--") && (i < 0 || j !== i + 1) && (d < 0 || j !== d + 1));
  if (!tag) throw new Error("usage: set-version.mjs <vX.Y.Z> [--build N] [--dry-run]");

  const parsed = parseVersion(tag);
  const build = buildArg !== undefined ? parseBuildNumber(buildArg) : deriveBuildNumber(parsed);

  const files = [
    ["app.json", stampAppJson(readJson("app.json"), parsed.version, build)],
    ["package.json", stampPackageJson(readJson("package.json"), parsed.version)],
  ];
  try {
    files.push(["package-lock.json", stampPackageLock(readJson("package-lock.json"), parsed.version)]);
  } catch (e) {
    if (e.code !== "ENOENT") throw e; // no lock file: nothing to keep in step
  }
  if (!dryRun) for (const [name, content] of files) writeFileSync(join(root, name), toJson(content));
  console.log(`${dryRun ? "Would set" : "Set"} version ${parsed.version}, build ${build} in ${files.map(([n]) => n).join(", ")}`);
}

try {
  main(process.argv);
} catch (e) {
  console.error(`set-version: ${e.message}`);
  process.exit(1);
}
