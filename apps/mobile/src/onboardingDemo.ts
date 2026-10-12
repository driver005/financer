/**
 * The demo bookings for the setup's "Try with demo data". Pure and deterministic: the same date,
 * payday and stores always give the same bookings, so loading twice adds nothing (the import
 * skips bookings it already has).
 *
 * Everything is labelled: the counterparty starts with "[DEMO]" and the purpose says it is demo
 * data, so it is never mistaken for a real booking. Only bookings are sent. The import endpoint
 * would also replace the budget and the usual-items list, which are the user's, so the demo
 * leaves them out.
 */

import type { Chain, ExportData } from "./api/client";
import { CHAIN_NAMES, CHAINS } from "./onboarding";

export const DEMO_TAG = "[DEMO]";
const DEMO_PURPOSE = "DEMO DATA, not a real booking";

type Row = ExportData["transactions"][number];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Last day of `month` (1-12). */
function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `year`/`month` moved back by `back` months. */
function monthsBack(year: number, month: number, back: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) - back;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

// Cents of one grocery trip, cycled through; an uneven spread so the numbers look lived in.
const TRIPS = [2347, 1189, 3560, 842, 2915, 1476, 4120, 1733, 2208, 967];
const TRIP_DAYS = [2, 5, 9, 12, 16, 19, 23, 26];

export const DEMO_SALARY_CENTS = 245_000;

/**
 * About four months of bookings ending today: a salary on `payday` (so income is recognised as
 * recurring), rent, a streaming subscription, a transit pass and grocery trips at the user's
 * stores. Bookings after `today` are left out.
 */
export function demoTransactions(today: string, payday = 1, chains: Chain[] = []): Row[] {
  const [ty, tm] = today.split("-").map(Number);
  const stores = (chains.length ? CHAINS.filter((c) => chains.includes(c)) : CHAINS).map((c) => CHAIN_NAMES[c]);
  const rows: Row[] = [];
  let trip = 0;
  for (let back = 3; back >= 0; back--) {
    const { year, month } = monthsBack(ty, tm, back);
    const at = (day: number) => `${year}-${pad(month)}-${pad(Math.min(day, daysIn(year, month)))}`;
    const add = (day: number, cents: number, who: string, what: string, category: string) => {
      const date = at(day);
      if (date <= today) {
        rows.push({
          booking_date: date,
          amount_cents: cents,
          counterparty: `${DEMO_TAG} ${who}`,
          purpose: `${DEMO_PURPOSE} (${what})`,
          category,
        });
      }
    };
    add(Math.min(Math.max(payday, 1), 28), DEMO_SALARY_CENTS, "Employer", "salary", "income");
    add(2, -72_000, "Landlord", "rent", "housing");
    add(8, -1_299, "Streaming", "subscription", "subscriptions");
    add(3, -4_900, "Transit pass", "monthly pass", "transport");
    for (const day of TRIP_DAYS) {
      add(day, -TRIPS[trip % TRIPS.length], stores[trip % stores.length], "groceries", "groceries");
      trip++;
    }
  }
  return rows.sort((a, b) => (a.booking_date < b.booking_date ? -1 : a.booking_date > b.booking_date ? 1 : a.counterparty.localeCompare(b.counterparty)));
}

/** The import document: bookings only (no budget, no usual items, no receipts, no settings). */
export function demoExport(today: string, payday = 1, chains: Chain[] = []): ExportData {
  return {
    version: 1,
    transactions: demoTransactions(today, payday, chains),
    budget: [],
    basket: [],
    receipts: [],
    settings: {},
  };
}

/** Whether a booking is part of the demo set. */
export function isDemoBooking(t: { counterparty: string }): boolean {
  return t.counterparty.startsWith(DEMO_TAG);
}

export type DemoGate = { allowed: boolean; reason?: string };

/**
 * Demo bookings only go into an empty backend. Next to real bookings they would change every
 * number on the Today screen, and the API has no way to take them out again.
 */
export function demoGate(bookings: { counterparty: string }[]): DemoGate {
  if (bookings.length === 0) return { allowed: true };
  if (bookings.every(isDemoBooking)) return { allowed: false, reason: "The demo data is already loaded." };
  return {
    allowed: false,
    reason: `There are already ${bookings.length} bookings here. Demo data would mix with them, so it is only offered on an empty setup.`,
  };
}
