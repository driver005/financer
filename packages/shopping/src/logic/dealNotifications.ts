// Deal messages become local notifications. The app asks the shopping API for messages newer
// than the last one it showed; the server (when it has push set up) may already have pushed the
// same deals, so each message id is shown at most once per device. The rules are in Rust
// (crates/logic, shop_misc.rs).

import { logic } from "../../../wire/src/logic";
import type { Notification } from "../api/types";

export type LocalNotice = { id: string; title: string; body: string; data: { eventId: number; productId: string; url: string } };
/**
 * Notices for messages not yet shown, and the id to remember. At most `max` notices are shown at
 * once; the rest collapse into one summary so the shade does not fill up after a long absence.
 */
export const planDealNotices = (items: Notification[], lastShownId: number, max = 3): { notices: LocalNotice[]; lastShownId: number } =>
  logic("shop_misc.plan_deal_notices", { items, last_shown_id: lastShownId, max });
