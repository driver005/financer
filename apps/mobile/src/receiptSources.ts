/**
 * Pure helpers for the Receipt sources screen: names and texts for the three sources, the status
 * pill, "last synced" wording, setup help, and reading the Lidl callback address. No React Native
 * imports, so tests can run them under Node.
 */

export type SourceKey = "email" | "lidl_plus" | "kaufland_card" | "folder";

export const SOURCE_ORDER: readonly SourceKey[] = ["email", "lidl_plus", "kaufland_card", "folder"];

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
    case "kaufland_card":
      return "Kaufland Card";
    case "rewe_app":
      return "REWE eBon (app)";
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
    case "kaufland_card":
      return "card-account-details-outline";
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
    case "kaufland_card":
      return "Reads the digital receipts of your Kaufland Card after you sign in on Kaufland's own page. Experimental.";
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
      case "kaufland_card":
        return [
          "Switch it on below. The setting stays on this phone.",
          "Then tap Connect. You sign in on Kaufland's own page; Financer never sees your password.",
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
    case "kaufland_card":
      return [
        "Switch it on with enabled = true under [receipts.kaufland] in financer.toml and restart the server.",
        "Come back here and tap Connect. You sign in on Kaufland's own page; Financer never sees your password.",
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

/** The shops whose receipts come in by signing in on the shop's own page. */
export type SignInShop = "Lidl" | "Kaufland";

/** The short, plain statements shown on the sign-in card of a shop. */
export function signInPromises(shop: SignInShop, onPhone = false): string[] {
  return [
    `You sign in on ${shop}'s own page. Financer never sees your password.`,
    `Only a refresh token is stored, ${onPhone ? "on this phone" : "on your server"}, encrypted.`,
    `This is unofficial. ${shop} has no public interface for this, so it can stop working at any time.`,
    "You can disconnect whenever you like. That deletes the token; receipts already imported stay.",
  ];
}

/** The statements of the Lidl Plus card. */
export function lidlPromises(onPhone = false): string[] {
  return signInPromises("Lidl", onPhone);
}

export const LIDL_PROMISES: readonly string[] = lidlPromises(false);

/** Where "Disconnect" says the saved sign-in is deleted from. */
export function disconnectedText(onPhone: boolean): string {
  return `Disconnected. The saved sign-in was deleted from ${onPhone ? "this phone" : "your server"}.`;
}

/** The empty state when no receipt source is on. */
export function noSourceText(onPhone: boolean): string {
  return onPhone
    ? "On this phone the receipts can come from Lidl Plus or the Kaufland Card. Switch one on in its card below. Mailbox and folder import need your own server."
    : "Receipts can arrive from your mailbox, from Lidl Plus, from the Kaufland Card or from a folder. Sources are switched on in the server's financer.toml; the cards below say how.";
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

/** The one-line state of a sign-in card. */
export function signInStateText(shop: SignInShop, state: string, connectedAt: number | null | undefined, nowSec: number, onPhone = false): string {
  switch (state) {
    case "connected":
      return connectedAt ? `Connected ${lastSyncText(connectedAt, nowSec).toLowerCase()}` : "Connected";
    case "needs_signin":
      return `${shop} no longer accepts the saved sign-in`;
    case "never":
      return "Not connected";
    default:
      return `Switched off on this ${onPhone ? "phone" : "server"}`;
  }
}

/** The one-line state of the Lidl card. */
export function lidlStateText(state: string, connectedAt: number | null | undefined, nowSec: number, onPhone = false): string {
  return signInStateText("Lidl", state, connectedAt, nowSec, onPhone);
}

// ---- shops that have an app but no way in ----

export type ShopGuide = {
  shop: string;
  /** What the shop offers, as far as it says so itself. */
  summary: string;
  /** How its receipts get into Financer. */
  steps: string[];
};

/**
 * REWE, Kaufland, Penny and ALDI. None of them offers a public interface for receipts. Kaufland has
 * an unofficial sign-in of its own (the card above); for the others this says what does work. REWE mails the eBon as a PDF
 * (the email source reads it); Kaufland and Penny keep the digital receipt inside their app; ALDI
 * is not known to offer one. Written from what the shops publish (checked on 2026-11-03), so a
 * shop may have changed it; the app itself is the authority.
 */
export const SHOP_GUIDES: readonly ShopGuide[] = [
  {
    shop: "REWE",
    summary: "The eBon comes by email as a PDF, or you read it from REWE's web shop in a window of the app (below).",
    steps: [
      "In the REWE app (or your account on rewe.de) switch on the eBon and hold the app to the scanner at the till. Without that scan you get a paper receipt, and a missing eBon cannot be sent again.",
      "By email: REWE mails the eBon as a PDF to the address of your REWE account. Connect that mailbox under Email above (needs your own server).",
      "Or in the app: tap Read my REWE receipts below, sign in on REWE's own page in the window and the new receipts are read. Unofficial; needs the phone app.",
    ],
  },
  {
    shop: "Kaufland",
    summary: "The Kaufland Card above signs in on Kaufland's own page and reads your digital receipts. Unofficial.",
    steps: [
      "In the Kaufland app, with your Kaufland Card, switch on the paperless receipt (\"Papierbon sparen\"); only receipts bought that way exist digitally.",
      "Switch the Kaufland Card on (the card above) and tap Connect. You sign in on Kaufland's own page.",
      "If Kaufland stops accepting it, scan a screenshot of the receipt under Receipts instead.",
    ],
  },
  {
    shop: "Penny",
    summary: "The eBon stays inside the PENNY app. Financer cannot sign in there.",
    steps: [
      "In the PENNY app switch on the eBon (it is off until you do) and scan the app at the till.",
      "Open the receipt in the app and take a screenshot.",
      "In Financer open Receipts and scan the screenshot. Penny receipts that reach your mailbox are picked up by the Email source.",
    ],
  },
  {
    shop: "ALDI",
    summary: "No digital receipt is known for ALDI, so there is nothing to connect.",
    steps: ["Keep the paper receipt and photograph it in Financer under Receipts.", "Your bank payment is matched to it afterwards, as with every other receipt."],
  },
];
