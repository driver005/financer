import { describe, expect, it } from "vitest";
import {
  dueOccurrences,
  firstDue,
  monthlyEquivalent,
  nextOccurrence,
  recurringExternalId,
  recurringMarker,
  resumeNextDue,
} from "@/lib/recurring";
import { recurringSchema } from "@/lib/schemas";
import { activityLabel } from "@/lib/activity";

const monthly31 = { cycle: "monthly" as const, start_date: "2026-01-31" };

describe("recurring schedule", () => {
  it("clamps to month end and returns to the anchor day", () => {
    expect(nextOccurrence("2026-01-31", monthly31)).toBe("2026-02-28");
    expect(nextOccurrence("2026-02-28", monthly31)).toBe("2026-03-31");
    expect(nextOccurrence("2028-01-31", { ...monthly31, start_date: "2028-01-31" })).toBe(
      "2028-02-29",
    );
  });
  it("respects day_of_month, interval, weekly and yearly", () => {
    const s = { cycle: "monthly" as const, start_date: "2026-01-05", day_of_month: 25 };
    expect(nextOccurrence("2026-01-25", s)).toBe("2026-02-25");
    expect(nextOccurrence("2026-01-25", { ...s, interval: 3 })).toBe("2026-04-25");
    expect(nextOccurrence("2026-10-01", { cycle: "weekly", start_date: "2026-10-01" })).toBe(
      "2026-10-08",
    );
    expect(
      nextOccurrence("2026-10-01", { cycle: "weekly", start_date: "2026-10-01", interval: 2 }),
    ).toBe("2026-10-15");
    const leap = { cycle: "yearly" as const, start_date: "2028-02-29" };
    expect(nextOccurrence("2028-02-29", leap)).toBe("2029-02-28");
    expect(nextOccurrence("2031-02-28", leap)).toBe("2032-02-29");
  });
  it("computes the first due date from start_date", () => {
    expect(firstDue({ cycle: "monthly", start_date: "2026-10-04", day_of_month: 25 })).toBe(
      "2026-10-25",
    );
    expect(firstDue({ cycle: "monthly", start_date: "2026-10-28", day_of_month: 25 })).toBe(
      "2026-11-25",
    );
    expect(firstDue({ cycle: "monthly", start_date: "2026-02-10", day_of_month: 31 })).toBe(
      "2026-02-28",
    );
    expect(firstDue({ cycle: "weekly", start_date: "2026-10-04", day_of_month: 9 })).toBe(
      "2026-10-04",
    );
  });
  it("lists missed occurrences up to today and advances next_due", () => {
    const r = dueOccurrences({ ...monthly31, next_due: "2026-07-31" }, "2026-10-04");
    expect(r.dates).toEqual(["2026-07-31", "2026-08-31", "2026-09-30"]);
    expect(r.next).toBe("2026-10-31");
    expect(r.ended).toBe(false);
    expect(dueOccurrences({ ...monthly31, next_due: "2026-10-31" }, "2026-10-04").dates).toEqual(
      [],
    );
  });
  it("caps catch-up to the latest occurrences", () => {
    const r = dueOccurrences(
      { cycle: "monthly", start_date: "2024-01-01", next_due: "2024-01-01" },
      "2026-10-04",
    );
    expect(r.dates).toHaveLength(12);
    expect(r.dates[0]).toBe("2025-11-01");
    expect(r.dates.at(-1)).toBe("2026-10-01");
    expect(r.skipped).toBe(22);
    expect(r.next).toBe("2026-11-01");
  });
  it("stops at end_date and flags the item as ended", () => {
    const r = dueOccurrences(
      {
        cycle: "monthly",
        start_date: "2026-08-01",
        next_due: "2026-08-01",
        end_date: "2026-09-15",
      },
      "2026-10-04",
    );
    expect(r.dates).toEqual(["2026-08-01", "2026-09-01"]);
    expect(r.ended).toBe(true);
  });
  it("skips missed occurrences when resuming a paused item", () => {
    const s = { cycle: "monthly" as const, start_date: "2026-01-25", next_due: "2026-03-25" };
    expect(resumeNextDue(s, "2026-10-04")).toBe("2026-10-25");
    expect(resumeNextDue(s, "2026-03-25")).toBe("2026-03-25");
  });
  it("builds dedup markers and monthly equivalents", () => {
    expect(recurringMarker("abc", "2026-10-01")).toBe("[auto:recurring:abc:2026-10-01]");
    expect(recurringExternalId("abc", "2026-10-01")).toBe("recurring:abc:2026-10-01");
    expect(monthlyEquivalent(1200, "yearly")).toBe(100);
    expect(monthlyEquivalent(300, "monthly", 3)).toBe(100);
    expect(Math.round(monthlyEquivalent(120, "weekly"))).toBe(520);
  });
});

describe("recurring schema", () => {
  const acc = "11111111-1111-4111-8111-111111111111";
  const acc2 = "22222222-2222-4222-8222-222222222222";
  it("defaults next_due from start_date and day_of_month", () => {
    const v = recurringSchema.parse({
      name: "Gaji",
      kind: "income",
      amount: "10000000",
      currency: "IDR",
      account_id: acc,
      cycle: "monthly",
      day_of_month: "25",
      start_date: "2026-10-04",
      next_due: "",
      end_date: "",
    });
    expect(v.next_due).toBe("2026-10-25");
    expect(v.interval).toBe(1);
    expect(v.auto_post).toBe(true);
    expect(v.to_account_id).toBeNull();
  });
  it("requires distinct accounts for transfers and drops the category", () => {
    const base = {
      name: "Tabungan",
      kind: "transfer",
      amount: 500000,
      currency: "IDR",
      cycle: "monthly",
      start_date: "2026-10-01",
      category_id: "33333333-3333-4333-8333-333333333333",
    };
    expect(recurringSchema.safeParse({ ...base, account_id: acc }).success).toBe(false);
    expect(
      recurringSchema.safeParse({ ...base, account_id: acc, to_account_id: acc }).success,
    ).toBe(false);
    const ok = recurringSchema.parse({ ...base, account_id: acc, to_account_id: acc2 });
    expect(ok.category_id).toBeNull();
  });
  it("rejects end_date before start_date", () => {
    expect(
      recurringSchema.safeParse({
        name: "Sewa",
        kind: "expense",
        amount: 1,
        currency: "IDR",
        cycle: "monthly",
        start_date: "2026-10-01",
        end_date: "2026-09-01",
      }).success,
    ).toBe(false);
  });
  it("has activity labels", () => {
    expect(activityLabel("recurring_transactions.create")).toBe("Transaksi Berulang ditambahkan");
    expect(activityLabel("recurring.post")).toBe("Transaksi berulang dicatat");
  });
});
