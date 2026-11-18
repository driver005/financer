import { describe, expect, it } from "vitest";
import {
  balanceSeries,
  draftFromLine,
  flowOf,
  matchStatement,
  monthSummary,
  normalizeAccountMonths,
  outflowByCategory,
  parseStatement,
  reconcileDifference,
  statementWindow,
  sumAccountMonthly,
  totalBalance,
  TRANSFER_OUT,
} from "@/lib/account-report";
import { parseCsv } from "@/lib/csv";

const A = "acc-a";
const B = "acc-b";
const food = { name: "Makan", color: "#d0703c" };
const rows = [
  { id: "1", kind: "income", amount: "1000000.00", account_id: A, occurred_at: "2026-08-01" },
  {
    id: "2",
    kind: "expense",
    amount: 50000,
    account_id: A,
    occurred_at: "2026-08-03",
    category: food,
  },
  {
    id: "3",
    kind: "transfer",
    amount: 200000,
    account_id: A,
    to_account_id: B,
    occurred_at: "2026-09-02",
  },
  {
    id: "4",
    kind: "transfer",
    amount: 75000,
    account_id: B,
    to_account_id: A,
    occurred_at: "2026-09-05",
  },
  {
    id: "5",
    kind: "expense",
    amount: 2500,
    account_id: A,
    occurred_at: "2026-09-02",
    category: { name: "Biaya Admin", color: null },
  },
  { id: "6", kind: "expense", amount: 9999, account_id: B, occurred_at: "2026-09-06" },
  {
    id: "7",
    kind: "transfer",
    amount: 10,
    account_id: A,
    to_account_id: A,
    occurred_at: "2026-09-07",
  },
];

/** Reference: the account_balances view formula, evaluated row by row. */
function viewBalance(initial: number, id: string) {
  let b = initial;
  for (const t of rows) {
    const v = Number(t.amount);
    if (t.account_id === id && t.kind === "income") b += v;
    else if (t.account_id === id && (t.kind === "expense" || t.kind === "transfer")) b -= v;
    else if (t.to_account_id === id && t.kind === "transfer") b += v;
  }
  return Math.round(b * 100) / 100;
}

describe("account flows", () => {
  it("classifies like the view", () => {
    expect(flowOf(rows[2]!, A)).toEqual({ inflow: 0, outflow: 200000 });
    expect(flowOf(rows[2]!, B)).toEqual({ inflow: 200000, outflow: 0 });
    expect(flowOf(rows[5]!, A)).toEqual({ inflow: 0, outflow: 0 });
    expect(flowOf(rows[6]!, A)).toEqual({ inflow: 0, outflow: 10 });
  });
  it("monthly totals and final balance equal account_balances", () => {
    const m = sumAccountMonthly(rows, A);
    expect(m).toEqual([
      { month: "2026-08", inflow: 1000000, outflow: 50000 },
      { month: "2026-09", inflow: 75000, outflow: 202510 },
    ]);
    expect(totalBalance(100, m)).toBe(viewBalance(100, A));
    expect(totalBalance(0, sumAccountMonthly(rows, B))).toBe(viewBalance(0, B));
  });
  it("normalizes rpc rows", () => {
    expect(normalizeAccountMonths([{ month: "2026-01", inflow: "1.25", outflow: null }])).toEqual([
      { month: "2026-01", inflow: 1.25, outflow: 0 },
    ]);
  });
  it("month summary chains opening → closing", () => {
    const m = sumAccountMonthly(rows, A);
    const sep = monthSummary(100, m, "2026-09");
    expect(sep).toEqual({ opening: 950100, inflow: 75000, outflow: 202510, closing: 822590 });
    expect(monthSummary(100, m, "2026-07")).toEqual({
      opening: 100,
      inflow: 0,
      outflow: 0,
      closing: 100,
    });
  });
  it("balance series covers N months ending at end month", () => {
    const s = balanceSeries(0, sumAccountMonthly(rows, A), "2026-10", 4);
    expect(s.map((x) => x.month)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(s.map((x) => x.balance)).toEqual([0, 950000, 822490, 822490]);
  });
  it("outflow breakdown groups transfers", () => {
    const sep = rows.filter((r) => r.occurred_at.startsWith("2026-09"));
    expect(outflowByCategory(sep, A)).toEqual([
      { name: TRANSFER_OUT, color: null, value: 200010 },
      { name: "Biaya Admin", color: null, value: 2500 },
    ]);
  });
});

describe("reconciliation", () => {
  it("parses signed amount statements", () => {
    const r = parseStatement(
      parseCsv(
        'Tanggal,Keterangan,Jumlah\n01/09/2026,GAJI,"1.000.000"\n02/09/2026,ATM,-50000\nxx,bad,1',
      ),
    );
    expect(r.missingHeaders).toEqual([]);
    expect(r.errors).toEqual([4]);
    expect(r.lines).toEqual([
      { line: 2, date: "2026-09-01", description: "GAJI", amount: 1000000 },
      { line: 3, date: "2026-09-02", description: "ATM", amount: -50000 },
    ]);
  });
  it("parses debit/credit columns and reports missing headers", () => {
    const r = parseStatement(
      parseCsv("date;description;debit;credit\n2026-09-01;fee;2500;\n2026-09-02;in;;10000"),
    );
    expect(r.lines.map((l) => l.amount)).toEqual([-2500, 10000]);
    expect(parseStatement([["foo", "bar"]]).missingHeaders).toEqual(["tanggal", "jumlah"]);
  });
  it("matches by amount and date ±2 days, each tx once", () => {
    const txs = rows.filter((r) => r.occurred_at >= "2026-09-01");
    const lines = [
      { line: 2, date: "2026-09-04", description: "TRF", amount: -200000 },
      { line: 3, date: "2026-09-05", description: "IN", amount: 75000 },
      { line: 4, date: "2026-09-05", description: "IN dup", amount: 75000 },
      { line: 5, date: "2026-09-10", description: "fee", amount: -2500 },
    ];
    const r = matchStatement(lines, txs, A);
    expect(r.matched.map((m) => [m.line.line, m.tx.id, m.days])).toEqual([
      [2, "3", 2],
      [3, "4", 0],
    ]);
    expect(r.unmatchedLines.map((l) => l.line)).toEqual([4, 5]);
    expect(r.unmatchedTx.map((t) => t.id)).toEqual(["5", "7"]);
  });
  it("prefers the closest date", () => {
    const txs = [
      { id: "x", kind: "expense", amount: 10, account_id: A, occurred_at: "2026-01-01" },
      { id: "y", kind: "expense", amount: 10, account_id: A, occurred_at: "2026-01-03" },
    ];
    const r = matchStatement(
      [{ line: 2, date: "2026-01-03", description: "", amount: -10 }],
      txs,
      A,
    );
    expect(r.matched[0]?.tx.id).toBe("y");
  });
  it("helpers", () => {
    expect(statementWindow([])).toBeNull();
    expect(
      statementWindow([
        { line: 2, date: "2026-09-10", description: "", amount: 1 },
        { line: 3, date: "2026-09-01", description: "", amount: 1 },
      ]),
    ).toEqual({ from: "2026-08-30", to: "2026-09-12" });
    expect(reconcileDifference(100.1, 100)).toBe(0.1);
    expect(
      draftFromLine({ line: 2, date: "2026-09-01", description: "ATM", amount: -5 }, A),
    ).toMatchObject({
      kind: "expense",
      amount: 5,
      account_id: A,
      occurred_at: "2026-09-01",
      description: "ATM",
    });
  });
});
