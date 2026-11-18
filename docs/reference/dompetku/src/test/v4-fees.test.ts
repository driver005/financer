import { describe, expect, it } from "vitest";
import {
  dueMonthlyFees,
  feeDate,
  feeOptions,
  formatPresets,
  monthlyFeeMarker,
  parsePresets,
  withTax,
} from "@/lib/fees";
import { accountSchema, subscriptionSchema, transactionSchema } from "@/lib/schemas";

describe("v4 fees & tax", () => {
  it("parses and formats presets", () => {
    const p = parsePresets("BI-FAST=2500; Online = 6.500 ;bad=; 1000");
    expect(p).toEqual([
      { label: "BI-FAST", amount: 2500 },
      { label: "Online", amount: 6500 },
      { label: "Biaya", amount: 1000 },
    ]);
    expect(formatPresets(p)).toBe("BI-FAST=2500; Online=6500; Biaya=1000");
  });
  it("offers sender transfer fees + receiver top-up fees", () => {
    const o = feeOptions(
      { id: "a", transfer_fees: [{ label: "BI-FAST", amount: 2500 }] },
      { id: "b", topup_fees: "Admin GoPay=1000" },
    );
    expect(o.map((x) => x.amount)).toEqual([2500, 1000]);
  });
  it("clamps fee date to month length", () => {
    expect(feeDate("2026-02", 31)).toBe("2026-02-28");
    expect(feeDate("2026-10", 5)).toBe("2026-10-05");
  });
  it("only charges due, unrecorded monthly fees", () => {
    const accs = [
      { id: "a", monthly_fee: 15000, monthly_fee_day: 3 },
      { id: "b", monthly_fee: 10000, monthly_fee_day: 20 },
      { id: "c", monthly_fee: 0 },
    ];
    expect(dueMonthlyFees(accs, "2026-10-10", new Set()).map((d) => d.account.id)).toEqual(["a"]);
    expect(dueMonthlyFees(accs, "2026-10-10", new Set([monthlyFeeMarker("a", "2026-10")]))).toEqual(
      [],
    );
  });
  it("adds optional tax", () => {
    expect(withTax(100000, 11)).toBe(111000);
    expect(withTax(9.99, null)).toBe(9.99);
  });
  it("schemas accept optional fee fields", () => {
    const a = accountSchema.parse({
      name: "BCA",
      type: "bank",
      currency: "IDR",
      transfer_fees: "BI-FAST=2500",
      monthly_fee: "",
      monthly_fee_day: "",
    });
    expect(a.transfer_fees).toEqual([{ label: "BI-FAST", amount: 2500 }]);
    expect(a.monthly_fee).toBeNull();
    expect(
      subscriptionSchema.parse({
        name: "X",
        amount: 10,
        currency: "USD",
        cycle: "monthly",
        next_due: "2026-10-01",
        tax_percent: "11",
      }).tax_percent,
    ).toBe(11);
    expect(
      transactionSchema.parse({
        kind: "transfer",
        amount: 50000,
        occurred_at: "2026-10-01",
        fee: "2500",
      }).fee,
    ).toBe(2500);
  });
});
