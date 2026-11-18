import { db } from "./db.server";
import { isMissingTable } from "./finance.server";
import { LOGIN_WINDOW_MS, pruneFailures } from "./login-throttle";

// Per-instance fallback used when activity_log is missing or unreadable.
let memFailures: number[] = [];

/** Counts failed logins in the last window, from activity_log when available. */
export async function recentLoginFailures(now = Date.now()): Promise<number> {
  memFailures = pruneFailures(memFailures, now);
  try {
    const since = new Date(now - LOGIN_WINDOW_MS).toISOString();
    const res = await db()
      .from("activity_log")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth.login_failed")
      .gte("created_at", since);
    if (res.error) {
      if (!isMissingTable(res.error))
        console.error("login throttle check failed", res.error.message);
      return memFailures.length;
    }
    return Math.max(res.count ?? 0, memFailures.length);
  } catch (e) {
    console.error("login throttle check failed", e);
    return memFailures.length;
  }
}

/** Records a failure in the in-memory fallback (activity_log is written separately). */
export function noteLoginFailure(now = Date.now()): void {
  memFailures = pruneFailures(memFailures, now);
  memFailures.push(now);
}
