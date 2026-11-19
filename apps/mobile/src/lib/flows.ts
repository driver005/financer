/** Real local implementations of the remaining Finanzguru help-center flows. */
import {
  accounts, addMoneyTransaction, allTransactions, transfer, updateTransaction,
} from "../db/moneyTracker";
import { getSetting, setSetting } from "../db/database";
import { core } from "../rust/core";

export type Account = { id: string; name: string; balanceCents: number; kind: string };
export type Booking = { id: number; date: string; merchant: string; amountCents: number; category: string; kind: string };

export async function loadFlowAccounts(): Promise<Account[]> {
  return accounts() as Promise<Account[]>;
}

export async function doTransfer(from: string, to: string, cents: number) {
  if (!from || !to || from === to || cents <= 0) throw new Error("Pick two different accounts and a positive amount.");
  await transfer(from, to, cents);
}

export async function loadBookings(): Promise<Booking[]> {
  const rows = await allTransactions();
  return rows.map((r) => ({
    id: Number(r.id ?? 0),
    date: String(r.date ?? ""),
    merchant: String(r.merchant ?? ""),
    amountCents: Number(r.amountCents ?? 0),
    category: String(r.category ?? ""),
    kind: String(r.kind ?? "expense"),
  })).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
}

export async function recordRefund(booking: Booking, cents: number) {
  if (cents <= 0) throw new Error("Enter a positive refund amount.");
  await addMoneyTransaction({
    date: new Date().toISOString().slice(0, 10),
    merchant: `Refund · ${booking.merchant}`,
    amountCents: cents,
    category: "Refund",
    kind: "income",
    accountId: "bank",
  });
}

export async function rebook(booking: Booking, category: string) {
  if (!category) throw new Error("Choose a category.");
  await updateTransaction(booking.id, { category });
}

export function splitBill(cents: number, count: number, mode: "equal" | "amount" | "percent", shares: number[]) {
  if (cents <= 0 || count < 2) throw new Error("Enter an amount and at least 2 people.");
  return core.splitBill(cents, count, mode, shares);
}

export type FlowSettings = {
  locale: string; timezone: string; startDay: string; biometrics: boolean;
  promoCode: string; plusActive: boolean;
};

export async function loadFlowSettings(): Promise<FlowSettings> {
  const [locale, timezone, startDay, biometrics, promoCode, plusActive] = await Promise.all([
    getSetting("locale"), getSetting("timezone"), getSetting("startDay"),
    getSetting("biometrics"), getSetting("promoCode"), getSetting("plusActive"),
  ]);
  return {
    locale: locale ?? "English", timezone: timezone ?? "UTC", startDay: startDay ?? "1",
    biometrics: biometrics === "1", promoCode: promoCode ?? "", plusActive: plusActive === "1",
  };
}

export async function saveFlowSetting(key: keyof FlowSettings, value: string | boolean) {
  await setSetting(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
}
