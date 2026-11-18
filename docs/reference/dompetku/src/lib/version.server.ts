/**
 * Update check against the GitHub "latest release" API (public, unauthenticated, no token).
 * Cached in memory for 6 h per repo; any failure (timeout, rate limit, no releases) returns
 * null and never throws, so the version badge simply hides the update notice.
 */
import { appVersion, parseLatestRelease, repoFromUrl, type LatestRelease } from "./version";
import { logError } from "./monitoring.server";

const TTL_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 3000;
const cache = new Map<string, { at: number; value: LatestRelease | null }>();

export async function latestRelease(): Promise<LatestRelease | null> {
  let repo = repoFromUrl(null);
  try {
    const { getBranding } = await import("./app-settings.server");
    const b = await getBranding();
    repo = repoFromUrl(b.github_url);
  } catch {
    /* settings unavailable: upstream repo */
  }
  const hit = cache.get(repo);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: LatestRelease | null = null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `dompetku-update-check/${appVersion()}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) value = parseLatestRelease(await res.json(), repo);
  } catch (e) {
    logError("version.update_check", e);
  }
  cache.set(repo, { at: Date.now(), value });
  return value;
}
