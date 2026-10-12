// Pure helpers for set-version.mjs (no file access here, so they can be unit-tested).

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Android's versionCode is a 32-bit signed integer. */
export const MAX_BUILD = 2_100_000_000;

/**
 * Parse a release tag such as `v1.4.2` (or `1.4.2`). Only plain MAJOR.MINOR.PATCH is accepted:
 * a pre-release suffix would share its build number with the final release, and the stores
 * require build numbers that only go up.
 */
export function parseVersion(input) {
  const m = SEMVER.exec(String(input ?? "").trim());
  if (!m) throw new Error(`not a version tag (expected vMAJOR.MINOR.PATCH): ${JSON.stringify(input)}`);
  const [major, minor, patch] = [m[1], m[2], m[3]].map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) throw new Error(`version number too large: ${input}`);
  return { major, minor, patch, version: `${major}.${minor}.${patch}` };
}

/**
 * The monotonic build number derived from a version: `major * 1_000_000 + minor * 1_000 + patch`,
 * so 1.2.3 is 1002003 and every higher version has a higher number. Minor and patch must stay
 * below 1000 and major below 2100 (the largest value Android accepts).
 */
export function deriveBuildNumber({ major, minor, patch }) {
  if (minor > 999 || patch > 999) throw new Error("minor and patch must be below 1000 to derive a build number");
  const build = major * 1_000_000 + minor * 1_000 + patch;
  if (build > MAX_BUILD) throw new Error("major version too large to derive a build number");
  return build;
}

/** A build number passed in by hand (for example a CI run number); a positive whole number. */
export function parseBuildNumber(input) {
  const s = String(input ?? "").trim();
  if (!/^\d+$/.test(s)) throw new Error(`build number must be a positive whole number: ${JSON.stringify(input)}`);
  const n = Number(s);
  if (n < 1 || n > MAX_BUILD) throw new Error(`build number out of range (1 to ${MAX_BUILD}): ${s}`);
  return n;
}

/** Return a copy of app.json's content with the version and build numbers set. */
export function stampAppJson(app, version, build) {
  const expo = { ...app.expo };
  expo.version = version;
  expo.android = { ...expo.android, versionCode: build };
  expo.ios = { ...expo.ios, buildNumber: String(build) };
  return { ...app, expo };
}

/** Return a copy of package.json's content with the version set. */
export function stampPackageJson(pkg, version) {
  return { ...pkg, version };
}

/** package-lock.json repeats the root package's version in two places; keep them in step. */
export function stampPackageLock(lock, version) {
  const out = { ...lock, version };
  if (lock.packages && lock.packages[""]) out.packages = { ...lock.packages, "": { ...lock.packages[""], version } };
  return out;
}

/** JSON as the repository keeps it: two spaces, trailing newline. */
export function toJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
