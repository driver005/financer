/**
 * Pure helpers for the Receipt sources screen: names and texts for the three sources, the status
 * pill, "last synced" wording, setup help, and reading the Lidl callback address. No React Native
 * imports, so tests can run them under Node.
 */

export type SourceKey = "email" | "lidl_plus" | "folder";

export const SOURCE_ORDER: readonly SourceKey[] = ["email", "lidl_plus", "folder"];

/** The fields of a source the helpers read (a subset of `ReceiptSource`). */
export type SourceLike = {
  source: string;
  enabled: boolean;
  state: string;
  last_run?: number | null;
  last_success?: number | null;
  last_error?: string | null;
  imported_total: number;
  last_imported: number;
};

export type PillTone = "good" | "bad" | "warn" | "muted" | "blue" | "accent";

export function isSourceKey(s: string): s is SourceKey {
  return (SOURCE_ORDER as readonly string[]).includes(s);
}

export function sourceTitle(s: string): string {
  switch (s) {
    case "email":
      return "Email";
    case "lidl_plus":
      return "Lidl Plus";
    case "folder":
      return "Watched folder";
    default:
      return s;
  }
}

export function sourceIcon(s: string): string {
  switch (s) {
    case "email":
      return "email-fast-outline";
    case "lidl_plus":
      return "cart-heart";
    case "folder":
      return "folder-download-outline";
    default:
      return "receipt-text-outline";
  }
}

/** One line saying what the source does. */
export function sourceBlurb(s: string): string {
  switch (s) {
    case "email":
      return "Reads the receipt mails your shops send you (REWE eBon and others) from your mailbox.";
    case "lidl_plus":
      return "Reads your Lidl Plus receipts after you sign in on Lidl's own page. Experimental.";
    case "folder":
      return "Imports any receipt PDF, text or web page you drop into a folder on your server.";
    default:
      return "";
  }
}

/** Label, tone and icon of the status chip. The label always says it in words (colour is not the only cue). */
export function healthPill(src: Pick<SourceLike, "state" | "enabled">): { label: string; tone: PillTone; icon: string } {
  switch (src.state) {
    case "ok":
      return { label: "Working", tone: "good", icon: "check-circle-outline" };
    case "running":
      return { label: "Syncing", tone: "blue", icon: "sync" };
    case "waiting":
      return { label: "Waiting for first run", tone: "muted", icon: "clock-outline" };
    case "error":
      return { label: "Problem", tone: "bad", icon: "alert-circle-outline" };
    case "not_connected":
      return { label: "Not connected", tone: "warn", icon: "link-off" };
    case "needs_signin":
      return { label: "Sign in again", tone: "warn", icon: "login" };
    default:
      return { label: "Off", tone: "muted", icon: "power-sleep" };
  }
}

/** "Never", "Just now", "12 min ago", "3 h ago", "Yesterday", "5 days ago". */
export function lastSyncText(ts: number | null | undefined, nowSec: number): string {
  if (ts == null) return "Never";
  const diff = Math.max(0, nowSec - ts);
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)} h ago`;
  const days = Math.floor(diff / 86_400);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

/** "Next run in 25 min", "Next run in 3 h", "Next run due now". */
export function nextRunText(ts: number | null | undefined, nowSec: number): string | null {
  if (ts == null) return null;
  const diff = ts - nowSec;
  if (diff <= 30) return "Next run due now";
  if (diff < 3600) return `Next run in ${Math.max(1, Math.round(diff / 60))} min`;
  if (diff < 86_400) return `Next run in ${Math.round(diff / 3600)} h`;
  return `Next run in ${Math.round(diff / 86_400)} days`;
}

export function importedText(n: number): string {
  if (n <= 0) return "No receipts yet";
  return n === 1 ? "1 receipt imported" : `${n} receipts imported`;
}

/** Can "Sync now" do something for this source? */
export function canSyncNow(src: Pick<SourceLike, "enabled" | "state">): boolean {
  return src.enabled && !["running", "not_connected", "needs_signin", "disabled"].includes(src.state);
}

/** Sources that need the person to do something. */
export function attentionCount(list: readonly SourceLike[]): number {
  return list.filter((s) => s.enabled && ["error", "needs_signin", "not_connected"].includes(s.state)).length;
}

/** The header sentence: how many sources are on and how many receipts they brought. */
export function summaryText(list: readonly SourceLike[]): string {
  const on = list.filter((s) => s.enabled).length;
  const receipts = list.reduce((n, s) => n + (s.imported_total ?? 0), 0);
  if (on === 0) return "No automatic source is switched on yet.";
  const sources = `${on} of ${list.length} sources on`;
  return receipts === 0 ? sources : `${sources}, ${receipts} ${receipts === 1 ? "receipt" : "receipts"} imported`;
}

/** What a finished sync did, for a short message under the button. */
export function syncResultText(imported: number, linked: number): string {
  const found = imported === 0 ? "No new receipts" : imported === 1 ? "1 new receipt" : `${imported} new receipts`;
  if (linked <= 0) return found + ".";
  return `${found}; ${linked === 1 ? "1 matched" : `${linked} matched`} to a bank payment.`;
}

/**
 * Setup steps. With `onPhone` (the on-phone backend, which has no financer.toml and no server)
 * only Lidl Plus can be switched on, from the app; the other two need a server.
 */
export function setupSteps(s: string, onPhone = false): string[] {
  if (onPhone) {
    switch (s) {
      case "lidl_plus":
        return [
          "Switch it on below. The setting stays on this phone.",
          "Then tap Connect. You sign in on Lidl's own page; Financer never sees your password.",
        ];
      case "email":
        return [
          "Not available on this phone: reading a mailbox needs a server that can stay connected. Connect your own server (Settings > Backend) to use it, or forward receipts to the Receipts screen by hand.",
        ];
      case "folder":
        return [
          "Not available on this phone: the app cannot watch a folder. Use Receipts > PDF to import a file you saved, or connect your own server.",
        ];
      default:
        return [];
    }
  }
  switch (s) {
    case "email":
      return [
        "Set the password in an environment variable on the server, for example FINANCER_IMAP_PASSWORD. It never goes into the config file.",
        "Add a [receipts.email] section to financer.toml with your mail server (host), your login (username) and the folder.",
        "Restart the server. Only mails from the shops' own addresses are downloaded; all other mail stays untouched.",
      ];
    case "lidl_plus":
      return [
        "Switch it on with enabled = true under [receipts.lidl_plus] in financer.toml and restart the server.",
        "Come back here and tap Connect. You sign in on Lidl's own page; Financer never sees your password.",
      ];
    case "folder":
      return [
        "Add a [receipts.folder] section to financer.toml with the path of a folder on the server.",
        "Restart the server, then drop receipt PDFs, text or web pages into that folder (a synced cloud folder works well).",
      ];
    default:
      return [];
  }
}

/** The short, plain statements shown on the Lidl Plus card. */
export function lidlPromises(onPhone = false): string[] {
  return [
    "You sign in on Lidl's own page. Financer never sees your password.",
    `Only a refresh token is stored, ${onPhone ? "on this phone" : "on your server"}, encrypted.`,
    "This is unofficial. Lidl has no public interface for this, so it can stop working at any time.",
    "You can disconnect whenever you like. That deletes the token; receipts already imported stay.",
  ];
}

export const LIDL_PROMISES: readonly string[] = lidlPromises(false);

/** Where "Disconnect" says the saved sign-in is deleted from. */
export function disconnectedText(onPhone: boolean): string {
  return `Disconnected. The saved sign-in was deleted from ${onPhone ? "this phone" : "your server"}.`;
}

/** The empty state when no receipt source is on. */
export function noSourceText(onPhone: boolean): string {
  return onPhone
    ? "On this phone the receipts can come from Lidl Plus. Switch it on in the Lidl Plus card below. Mailbox and folder import need your own server."
    : "Receipts can arrive from your mailbox, from Lidl Plus or from a folder. Sources are switched on in the server's financer.toml; the cards below say how.";
}

/** Where the sign-in can be completed: inside the app (a browser sheet that hands the address back) or by pasting it. */
export type SignInMode = "auth-session" | "paste";

export function signInMode(platformOs: string): SignInMode {
  return platformOs === "ios" || platformOs === "android" ? "auth-session" : "paste";
}

/**
 * Find the callback address (`com.lidlplus.app://callback?code=...`) in whatever was pasted: the
 * bare address, an address with spaces or quotes around it, or a line of text containing it.
 * Returns `null` when there is none.
 */
export function extractCallbackUrl(input: string, scheme: string): string | null {
  const text = input.trim();
  const marker = `${scheme}://`;
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const rest = text.slice(at);
  const end = rest.search(/[\s"'<>]/);
  const url = end < 0 ? rest : rest.slice(0, end);
  return url.length > marker.length ? url : null;
}

/** Does the address carry a sign-in result (a code or an error)? */
export function callbackHasResult(url: string): boolean {
  return /[?&#](code|error)=/.test(url);
}

/** The one-line state of the Lidl card. */
export function lidlStateText(state: string, connectedAt: number | null | undefined, nowSec: number): string {
  switch (state) {
    case "connected":
      return connectedAt ? `Connected ${lastSyncText(connectedAt, nowSec).toLowerCase()}` : "Connected";
    case "needs_signin":
      return "Lidl no longer accepts the saved sign-in";
    case "never":
      return "Not connected";
    default:
      return "Switched off on this server";
  }
}
