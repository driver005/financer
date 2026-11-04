/**
 * The demo bookings for the setup's "Try with demo data". Deterministic: the same date, payday and stores
 * always give the same bookings, so loading twice adds nothing (the import skips bookings it already has).
 * The rules are in Rust (crates/logic, app_misc.rs).
 *
 * Everything is labelled: the counterparty starts with "[DEMO]" and the purpose says it is demo
 * data, so it is never mistaken for a real booking. Only bookings are sent. The import endpoint
 * would also replace the budget and the usual-items list, which are the user's, so the demo
 * leaves them out.
 */

import { logic } from "../../../packages/wire/src/logic";
import type { Chain, ExportData } from "./api/client";

export const DEMO_TAG = "[DEMO]";

type Row = ExportData["transactions"][number];

/**
 * About four months of bookings ending today: a salary on `payday` (so income is recognised as
 * recurring), rent, a streaming subscription, a transit pass and grocery trips at the user's
 * stores. Bookings after `today` are left out.
 */
export const demoTransactions = (today: string, payday = 1, chains: Chain[] = []): Row[] => logic("app_misc.demo_transactions", { today, payday, chains });

/** The import document: bookings only (no budget, no usual items, no receipts, no settings). */
export const demoExport = (today: string, payday = 1, chains: Chain[] = []): ExportData => logic("app_misc.demo_export", { today, payday, chains });

/** Whether a booking is part of the demo set. */
export const isDemoBooking = (t: { counterparty: string }): boolean => logic("app_misc.is_demo_booking", { t });

export type DemoGate = { allowed: boolean; reason?: string };

/**
 * Demo bookings only go into an empty backend. Next to real bookings they would change every
 * number on the Today screen, and the API has no way to take them out again.
 */
export const demoGate = (bookings: { counterparty: string }[]): DemoGate => logic("app_misc.demo_gate", { bookings });
