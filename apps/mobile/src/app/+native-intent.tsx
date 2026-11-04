/**
 * Addresses that reach the app from outside.
 *
 * - The Lidl Plus and Kaufland Card sign-ins end on `com.lidlplus.app://callback?code=...` and
 *   `com.kaufland.kaufland://oauth/callback?code=...`; the sign-in session reads those addresses
 *   itself, so the router must not treat them as screens to open (there is none, it would show
 *   "unmatched route"). They are sent to the Receipt sources screen, where the sign-in was started.
 * - A file or text shared to Financer from another app arrives as `financer://dataUrl=...`
 *   (expo-share-intent); it opens the Share screen, which reads what was shared.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.startsWith("com.lidlplus.app:") || path.startsWith("com.kaufland.kaufland:")) return "/receipt-sources";
  if (path.includes("dataUrl=")) return "/share";
  return path;
}
