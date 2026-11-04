/**
 * The Receipt sources screen: names and texts for the three sources, the status pill, "last synced"
 * wording, setup help, and reading the Lidl callback address. The wording is in Rust
 * (crates/logic, receipt_sources.rs); the types and the shop guides (plain content) are here.
 */
import { logic } from "../../../packages/wire/src/logic";

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

export const sourceTitle = (s: string): string => logic("receipt_sources.source_title", { s });

export const sourceIcon = (s: string): string => logic("receipt_sources.source_icon", { s });

/** One line saying what the source does. */
export const sourceBlurb = (s: string): string => logic("receipt_sources.source_blurb", { s });

/** Label, tone and icon of the status chip. The label always says it in words (colour is not the only cue). */
export const healthPill = (src: Pick<SourceLike, "state" | "enabled">): { label: string; tone: PillTone; icon: string } =>
  logic("receipt_sources.health_pill", { state: src.state });

/** "Never", "Just now", "12 min ago", "3 h ago", "Yesterday", "5 days ago". */
export const lastSyncText = (ts: number | null | undefined, nowSec: number): string =>
  logic("receipt_sources.last_sync_text", { ts: ts ?? null, now_sec: nowSec });

/** "Next run in 25 min", "Next run in 3 h", "Next run due now". */
export const nextRunText = (ts: number | null | undefined, nowSec: number): string | null =>
  logic("receipt_sources.next_run_text", { ts: ts ?? null, now_sec: nowSec });

export const importedText = (n: number): string => logic("receipt_sources.imported_text", { n });

/** Can "Sync now" do something for this source? */
export const canSyncNow = (src: Pick<SourceLike, "enabled" | "state">): boolean =>
  logic("receipt_sources.can_sync_now", { enabled: src.enabled, state: src.state });

/** Sources that need the person to do something. */
export const attentionCount = (list: readonly SourceLike[]): number => logic("receipt_sources.attention_count", { list });

/** The header sentence: how many sources are on and how many receipts they brought. */
export const summaryText = (list: readonly SourceLike[]): string => logic("receipt_sources.summary_text", { list });

/** What a finished sync did, for a short message under the button. */
export const syncResultText = (imported: number, linked: number): string => logic("receipt_sources.sync_result_text", { imported, linked });

/**
 * Setup steps. With `onPhone` (the on-phone backend, which has no financer.toml and no server)
 * only Lidl Plus can be switched on, from the app; the other two need a server.
 */
export const setupSteps = (s: string, onPhone = false): string[] => logic("receipt_sources.setup_steps", { s, on_phone: onPhone });

/** The short, plain statements shown on the Lidl Plus card. */
export const lidlPromises = (onPhone = false): string[] => logic("receipt_sources.lidl_promises", { on_phone: onPhone });

/** Where "Disconnect" says the saved sign-in is deleted from. */
export const disconnectedText = (onPhone: boolean): string => logic("receipt_sources.disconnected_text", { on_phone: onPhone });

/** The empty state when no receipt source is on. */
export const noSourceText = (onPhone: boolean): string => logic("receipt_sources.no_source_text", { on_phone: onPhone });

/** Where the sign-in can be completed: inside the app (a browser sheet that hands the address back) or by pasting it. */
export type SignInMode = "auth-session" | "paste";

export const signInMode = (platformOs: string): SignInMode => logic("receipt_sources.sign_in_mode", { platform_os: platformOs });

/**
 * Find the callback address (`com.lidlplus.app://callback?code=...`) in whatever was pasted: the
 * bare address, an address with spaces or quotes around it, or a line of text containing it.
 * Returns `null` when there is none.
 */
export const extractCallbackUrl = (input: string, scheme: string): string | null =>
  logic("receipt_sources.extract_callback_url", { input, scheme });

/** Does the address carry a sign-in result (a code or an error)? */
export const callbackHasResult = (url: string): boolean => logic("receipt_sources.callback_has_result", { url });

/** The one-line state of the Lidl card. */
export const lidlStateText = (state: string, connectedAt: number | null | undefined, nowSec: number, onPhone = false): string =>
  logic("receipt_sources.lidl_state_text", { state, connected_at: connectedAt ?? null, now_sec: nowSec, on_phone: onPhone });

// ---- shops that have an app but no way in ----

export type ShopGuide = {
  shop: string;
  /** What the shop offers, as far as it says so itself. */
  summary: string;
  /** How its receipts get into Financer. */
  steps: string[];
};

/**
 * REWE, Kaufland, Penny and ALDI. None of them offers a public interface for receipts, so Financer
 * does not sign in to their apps; this says for each what does work. REWE mails the eBon as a PDF
 * (the email source reads it); Kaufland and Penny keep the digital receipt inside their app; ALDI
 * is not known to offer one. Written from what the shops publish (checked on 2026-11-03), so a
 * shop may have changed it; the app itself is the authority.
 */
export const SHOP_GUIDES: readonly ShopGuide[] = [
  {
    shop: "REWE",
    summary: "The eBon comes by email as a PDF. Financer reads it from your mailbox.",
    steps: [
      "In the REWE app (or your account on rewe.de) switch on the eBon and hold the app to the scanner at the till. Without that scan you get a paper receipt, and a missing eBon cannot be sent again.",
      "REWE mails the eBon as a PDF to the address of your REWE account.",
      "Connect that mailbox under Email above (needs your own server). Receipts then arrive by themselves.",
    ],
  },
  {
    shop: "Kaufland",
    summary: "The digital receipt stays inside the Kaufland app. Financer cannot sign in there.",
    steps: [
      "In the Kaufland app, with your Kaufland Card, switch on the paperless receipt (\"Papierbon sparen\").",
      "Open the receipt in the app and take a screenshot.",
      "In Financer open Receipts and scan the screenshot. Kaufland receipts that reach your mailbox are picked up by the Email source.",
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
