// Deal messages become local notifications. The app asks the shopping API for messages newer
// than the last one it showed; the server (when it has push set up) may already have pushed the
// same deals, so each message id is shown at most once per device.

import type { Notification } from "../api/types";
import { formatCents } from "./format";

export type LocalNotice = { id: string; title: string; body: string; data: { eventId: number; productId: string; url: string } };

export function noticeFor(n: Notification): LocalNotice {
  const e = n.event;
  const reduced = e.reference_cents && e.reference_cents > e.price_cents ? ` (was about ${formatCents(e.reference_cents)})` : "";
  const why =
    e.kind === "below_target" ? "Below your target price" : e.kind === "new_low" ? "Lowest price we have seen" : "Good deal";
  return {
    id: `financer.shop.deal.${n.id}`,
    title: `${why}: ${e.title}`,
    body: `${n.message}${reduced}`,
    data: { eventId: n.id, productId: e.product_id, url: e.url },
  };
}

/**
 * Notices for messages not yet shown, and the id to remember. At most `max` notices are shown at
 * once; the rest collapse into one summary so the shade does not fill up after a long absence.
 */
export function planDealNotices(items: Notification[], lastShownId: number, max = 3): { notices: LocalNotice[]; lastShownId: number } {
  const fresh = items.filter((n) => n.id > lastShownId && !n.read).sort((a, b) => a.id - b.id);
  const newest = fresh.length ? fresh[fresh.length - 1].id : lastShownId;
  if (fresh.length <= max) return { notices: fresh.map(noticeFor), lastShownId: newest };
  const shown = fresh.slice(-(max - 1)).map(noticeFor);
  const rest = fresh.length - shown.length;
  const summary: LocalNotice = {
    id: `financer.shop.deal.summary.${newest}`,
    title: `${rest} more deals`,
    body: "Open the Deals tab to see them.",
    data: { eventId: newest, productId: "", url: "" },
  };
  return { notices: [summary, ...shown], lastShownId: newest };
}
