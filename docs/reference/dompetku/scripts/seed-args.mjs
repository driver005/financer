/**
 * Pure argument + safety parsing for scripts/seed-demo.mjs (unit-tested in src/test/seed-args.test.ts).
 *
 * A local database (127.0.0.1 / localhost / docker host) can be seeded freely. Any other host
 * is refused unless BOTH `--allow-remote` is passed AND env DEMO_RESET_CONFIRM=yes is set, so a
 * copy-pasted command can never wipe a real database by accident.
 */
export const LOCAL_HOSTS = ["127.0.0.1", "localhost", "0.0.0.0", "host.docker.internal", "::1"];

export function isLocalHost(host) {
  return LOCAL_HOSTS.includes(String(host).replace(/^\[|\]$/g, ""));
}

/**
 * @param {string[]} argv  process.argv.slice(2)
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, reset: boolean, allowRemote: boolean, host: string, url: string, key: string }
 *   | { ok: false, error: string }}
 */
export function parseSeedArgs(argv, env) {
  const args = new Set(argv);
  const unknown = argv.filter((a) => !["--reset", "--allow-remote"].includes(a));
  if (unknown.length) return { ok: false, error: `Unknown argument(s): ${unknown.join(" ")}` };
  const reset = args.has("--reset");
  const allowRemote = args.has("--allow-remote");
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return {
      ok: false,
      error: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see docs/DEMO-DATA.md).",
    };
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return { ok: false, error: `SUPABASE_URL is not a valid URL: ${url}` };
  }
  if (!isLocalHost(host)) {
    if (!allowRemote)
      return {
        ok: false,
        error: `Refusing to seed non-local database (${host}). Pass --allow-remote if you mean it.`,
      };
    if (env.DEMO_RESET_CONFIRM !== "yes")
      return {
        ok: false,
        error: `Refusing to seed remote database (${host}) without DEMO_RESET_CONFIRM=yes. This wipes ALL data — only use it on a throwaway demo project.`,
      };
  }
  return { ok: true, reset, allowRemote, host, url, key };
}

/**
 * Category seeds from supabase/schema.sql (every `insert into public.categories … values …`),
 * so a reset restores exactly the defaults a fresh install has.
 * @param {string} sql
 * @returns {{ name: string, kind: string, color: string }[]}
 */
export function defaultCategoriesFromSchema(sql) {
  const out = [];
  const seen = new Set();
  const blocks =
    sql.match(/insert into public\.categories[^;]*?values([\s\S]*?)on conflict/gi) ?? [];
  for (const b of blocks)
    for (const m of b.matchAll(
      /\(\s*'([^']+)'\s*,\s*'(income|expense)'\s*,\s*'(#[0-9a-fA-F]{3,8})'\s*\)/g,
    )) {
      const k = `${m[1]}|${m[2]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ name: m[1], kind: m[2], color: m[3] });
    }
  return out;
}
