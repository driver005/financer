/**
 * Real local data behind the Finanzguru parity screens.
 * Every number comes from the on-device SQLite DB and the Rust core — no mock data.
 */
import {
  allTransactions, accounts, addAccount, addRecurring, budgets, debts,
  goals, recurringList, updateTransaction,
} from "../db/moneyTracker";
import { receivables, subscriptions } from "../db/upstreamFeatures";
import { offers, getStores } from "../db/money";
import { getSetting, setSetting } from "../db/database";
import { core } from "../rust/core";

type Row = Record<string, unknown>;
const str = (row: Row, key: string) => String(row[key] ?? "");
const cents = (row: Row, key = "amountCents") => Number(row[key] ?? 0);

export type TxRow = { id: number; date: string; merchant: string; amountCents: number; category: string; kind: string };
const asTx = (r: Row): TxRow => ({
  id: Number(r.id ?? 0), date: str(r, "date"), merchant: str(r, "merchant"),
  amountCents: cents(r), category: str(r, "category"), kind: str(r, "kind"),
});

/* ---------------- Insights (Analysis tab) ---------------- */

export async function loadInsights() {
  const [rows, budgetRows] = await Promise.all([allTransactions(), budgets()]);
  const month = core.monthKey(new Date());
  const previous = core.shiftPeriod("month", month, -1);
  const spending = core.categoryTotals(rows, month) as { category: string; cents: number }[];
  return {
    count: rows.length,
    month,
    totals: core.txTotals(rows, month) as { income: number; expense: number; balance: number },
    comparison: core.compareMonths(rows, month, previous) as {
      current: number; previous: number;
      categories: { category: string; current: number; previous: number; changePercent: number }[];
    },
    categories: spending,
    budgetStatus: core.budgetStatus(budgetRows, spending) as {
      category: string; spent: number; limit: number; remaining: number; percent: number;
    }[],
    tips: [
      core.assistant("what is my biggest category", rows, budgetRows),
      core.assistant("average per day", rows, budgetRows),
      core.assistant("how much did I spend", rows, budgetRows),
    ],
  };
}

/* ---------------- Insurance ---------------- */

const COVERAGE = [
  { key: "Health", label: "Health insurance", emoji: "🏥", terms: ["health", "kranken", "aok", "barmer", "techniker"] },
  { key: "Home", label: "Home & contents", emoji: "🏠", terms: ["home", "haus", "wohn", "gebäude", "contents"] },
  { key: "Liability", label: "Personal liability", emoji: "🛡️", terms: ["liability", "haftpflicht", "privathaft"] },
  { key: "Auto", label: "Car insurance", emoji: "🚗", terms: ["auto", "car", "kfz", "vehicle"] },
  { key: "Life", label: "Life insurance", emoji: "❤️", terms: ["life", "leben", "risikoleben"] },
  { key: "Legal", label: "Legal insurance", emoji: "⚖️", terms: ["legal", "rechtsschutz"] },
];

export type Policy = { id: number; name: string; detail: string; cents: number; emoji: string };
const insuranceTerms = ["insurance", "versicherung", "huk", "allianz", "generali", "devk", "signal", "axis", "kranken", "haftpflicht"];

export async function loadInsurance() {
  const [rec, debt, subs, receiv] = await Promise.all([recurringList(), debts(), subscriptions(), receivables()]);
  const policies: Policy[] = [
    ...rec.filter((r) => isInsurance(r.name, r.category)).map((r) => ({
      id: r.id, name: r.name, detail: r.category || "Recurring policy", cents: r.amountCents, emoji: "🛡️",
    })),
    ...subs.filter((s) => isInsurance(s.name, "Subscription")).map((s) => ({
      id: s.id, name: s.name, detail: "Subscription", cents: s.amountCents, emoji: "📄",
    })),
    ...debt.filter((d) => isInsurance(d.name, "Debt")).map((d) => ({
      id: d.id, name: d.name, detail: "Outstanding premiums", cents: Math.round(d.totalCents / 12), emoji: "💳",
    })),
    ...receiv.filter((r) => isInsurance(r.name, "Receivable")).map((r) => ({
      id: r.id, name: r.name, detail: "Claim outstanding", cents: r.totalCents, emoji: "📥",
    })),
  ];
  return {
    policies,
    monthlyCents: policies.reduce((sum, p) => sum + p.cents, 0),
    coverage: COVERAGE.map((area) => ({
      ...area, covered: policies.some((p) => area.terms.some((t) => `${p.name} ${p.detail}`.toLowerCase().includes(t))),
    })),
  };
}

function isInsurance(name: string, category: string) {
  const text = `${name} ${category}`.toLowerCase();
  return insuranceTerms.some((term) => text.includes(term));
}

export async function addPolicy(areaKey: string, monthlyCents: number) {
  const area = COVERAGE.find((c) => c.key === areaKey);
  if (!area || monthlyCents <= 0) return;
  const day = new Date().getDate();
  await addRecurring({ name: `${area.label} (Finanzguru)`, amountCents: monthlyCents, dayOfMonth: day, category: "Insurance", active: 1 });
}

/* ---------------- Savings Booster ---------------- */

export async function loadSavings() {
  const [goalRows, offerRows, rows, reserved, reservedPoints, setting, storeRows] = await Promise.all([
    goals(), offers(), allTransactions(), getSetting("savingsReserve"),
    getSetting("savingsReservePoints"), getSetting("savingsBoosterPoints"), getStores(),
  ]);
  const storeNames = new Map(storeRows.map((s) => [s.id, s.name]));
  const stores = core.supermarkets();
  const cashbackRows = rows.filter((r) => str(r, "kind") !== "income" && core.matchStore(str(r, "merchant"), stores));
  const savedCents = goalRows.reduce((sum, g) => sum + g.savedCents, 0);
  const points = Number(setting ?? 0) || Math.round(savedCents / 100) + cashbackRows.length * 5;
  return {
    points,
    cashbackCount: cashbackRows.length,
    savedCents,
    goals: core.goalStatus(goalRows) as {
      name: string; target: number; saved: number; remaining: number; percent: number; daysLeft: number;
    }[],
    offers: offerRows.slice(0, 6).map((o) => ({ ...o, storeName: storeNames.get(o.storeId) ?? o.storeId })),
    reserved: reserved === "1",
    reservedPoints: Number(reservedPoints ?? 0),
    bonusPoints: Math.round(points * 0.07),
  };
}

export async function reservePoints(points: number) {
  await setSetting("savingsReserve", "1");
  await setSetting("savingsReservePoints", String(points));
}

/* ---------------- Automatic categorisation ---------------- */

export type MerchantCategory = { merchant: string; category: string; count: number; cents: number };

export async function loadCategorised() {
  const rows = await allTransactions().then((r) => r.map(asTx));
  const map = new Map<string, MerchantCategory>();
  for (const row of rows.filter((r) => r.kind !== "income")) {
    const slot = map.get(row.merchant) ?? { merchant: row.merchant, category: row.category || "Uncategorised", count: 0, cents: 0 };
    slot.count += 1;
    slot.cents += row.amountCents;
    map.set(row.merchant, slot);
  }
  const merchants = [...map.values()].sort((a, b) => b.count - a.count).slice(0, 14);
  return {
    merchants,
    total: rows.length,
    categorised: rows.filter((r) => r.category && r.category.toLowerCase() !== "uncategorised").length,
  };
}

export const CATEGORY_CHOICES = [
  "Groceries", "Streaming", "Internet & Phone", "Transport", "Living",
  "Food & Drinks", "Shopping", "Health", "Leisure", "Uncategorised",
];

export async function setMerchantCategory(merchant: string, category: string) {
  const rows = await allTransactions();
  await Promise.all(rows.filter((r) => str(r, "merchant") === merchant)
    .map((r) => updateTransaction(Number(r.id), { category })));
}

/* ---------------- Connect accounts ---------------- */

export const BANKS = [
  { name: "Sparkasse", emoji: "S", color: "#E30613" },
  { name: "N26", emoji: "N26", color: "#111111" },
  { name: "DKB", emoji: "DKB", color: "#0072BC" },
  { name: "Commerzbank", emoji: "C", color: "#F9BA00" },
  { name: "Deutsche Bank", emoji: "◊", color: "#0018A8" },
  { name: "Postbank", emoji: "P", color: "#E30613" },
  { name: "ING", emoji: "ING", color: "#FF6200" },
  { name: "Revolut", emoji: "R", color: "#191C1F" },
  { name: "PayPal", emoji: "P", color: "#0070BA" },
  { name: "Volksbank", emoji: "V", color: "#E30613" },
  { name: "HypoVereinsbank", emoji: "H", color: "#005CA9" },
  { name: "Trade Republic", emoji: "T", color: "#1FE6A0" },
];

export async function loadConnect() {
  return { accounts: await accounts() };
}

export async function connectBank(name: string, kind = "bank") {
  await addAccount(name, kind);
  return loadConnect();
}
