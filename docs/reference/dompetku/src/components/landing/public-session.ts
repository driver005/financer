/** Whether the visitor of a public page (landing, privacy, terms) is signed in; never throws. */
export async function isAuthenticated(): Promise<boolean> {
  const { getCachedSession, setCachedSession } = await import("@/lib/session-cache");
  const hit = getCachedSession();
  if (hit) return true;
  try {
    const { getSession } = await import("@/lib/auth.functions");
    const s = await getSession();
    if (s.authenticated) setCachedSession(s.user);
    return s.authenticated;
  } catch {
    return false;
  }
}
