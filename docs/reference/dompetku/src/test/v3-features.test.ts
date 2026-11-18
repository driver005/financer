/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed in-memory DB fakes */
import { describe, expect, it, vi } from "vitest";
import { activityDetail, activityLabel } from "../lib/activity";
import { classifyBotCommand, parseAmount } from "../lib/bot";
import { goldHoldings, goldValue, receivableStatus } from "../lib/assets";

const missing = {
  data: null,
  error: {
    code: "PGRST205",
    message: "Could not find the table 'public.activity_log' in the schema cache",
  },
};
vi.mock("../lib/db.server", () => {
  const chain: any = new Proxy(() => chain, {
    get: (_t, k) => (k === "then" ? (r: (v: unknown) => void) => r(missing) : chain),
    apply: () => chain,
  });
  return { db: () => ({ from: () => chain }) };
});

import { isMissingTable, listActivity, logActivity } from "../lib/finance.server";

describe("activity log tahan tabel hilang", () => {
  it("mengenali error tabel hilang", () => {
    expect(isMissingTable(missing.error)).toBe(true);
    expect(isMissingTable({ message: "duplicate key" })).toBe(false);
  });
  it("listActivity mengembalikan [] dan logActivity tidak melempar", async () => {
    await expect(listActivity(10)).resolves.toEqual([]);
    await expect(logActivity("auth.login")).resolves.toBeUndefined();
  });
});

describe("label aktivitas", () => {
  it("membuat label yang mudah dibaca", () => {
    expect(activityLabel("transactions.create")).toBe("Transaksi ditambahkan");
    expect(activityLabel("gold_purchases.delete")).toBe("Emas dihapus");
    expect(activityLabel("auth.login_failed")).toBe("Login gagal");
    const en: Record<string, string> = { Akun: "Account", diubah: "updated" };
    expect(activityLabel("accounts.update", (s) => en[s] ?? s)).toBe("Account updated");
    expect(
      activityDetail({ name: "Kopi", amount: 25000, currency: "IDR" }, (n, c) => `${c} ${n}`),
    ).toBe("Kopi · IDR 25000");
  });
});

describe("bot tarik tunai", () => {
  it("mengurai nominal dan akun", () => {
    expect(classifyBotCommand("tarik tunai 500rb")).toEqual({
      type: "withdraw",
      amount: 500000,
      from: null,
    });
    expect(classifyBotCommand("Tarik tunai 1,5jt dari BCA")).toEqual({
      type: "withdraw",
      amount: 1500000,
      from: "bca",
    });
    expect(parseAmount("250.000")).toBe(250000);
  });
});

describe("emas & piutang", () => {
  it("menghitung rata-rata harga dan penjualan", () => {
    const rows = [
      { kind: "sell" as const, grams: 1, price_per_gram: 1_500_000, total: 1_500_000 },
      { kind: "buy" as const, grams: 2, price_per_gram: 1_100_000, total: 2_200_000 },
      { kind: "buy" as const, grams: 2, price_per_gram: 900_000, total: 1_800_000 },
    ]; // terbaru dulu
    const h = goldHoldings(rows);
    expect(h.grams).toBe(3);
    expect(h.avgPrice).toBe(1_000_000);
    expect(h.realized).toBe(500_000);
    expect(
      goldValue(
        3,
        {
          source: "world",
          date: "2026-10-03",
          buy: 1_200_000,
          buyback: 1_200_000,
          estimated: false,
        },
        h.cost,
      )?.pnl,
    ).toBe(600_000);
  });
  it("menghitung sisa piutang", () => {
    expect(receivableStatus(1000, [{ amount: 300 }, { amount: 200 }])).toEqual({
      paid: 500,
      remaining: 500,
      progress: 50,
    });
  });
});
