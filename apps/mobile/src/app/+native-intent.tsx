/**
 * Addresses that reach the app from outside. The Lidl Plus sign-in ends on
 * `com.lidlplus.app://callback?code=...`; the sign-in session reads that address itself, so the
 * router must not treat it as a screen to open (there is none, it would show "unmatched route").
 * It is sent to the Receipt sources screen, which is where the sign-in was started.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.startsWith("com.lidlplus.app:")) return "/receipt-sources";
  return path;
}
