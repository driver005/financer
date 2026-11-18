import { describe, expect, it } from "vitest";
import {
  balanceLastRow,
  rowsFromItems,
  splitDescription,
  splitRemaining,
  splitSum,
  validateSplit,
} from "../lib/split";

describe("split math", () => {
  const rows = [
    { category_id: "a", amount: "60000" },
    { category_id: "b", amount: 40000.5 },
  ];
  it("sums rows and computes remaining", () => {
    expect(splitSum(rows)).toBe(100000.5);
    expect(splitRemaining(150000, rows)).toBe(49999.5);
    expect(splitRemaining("100000.5", rows)).toBe(0);
  });
  it("validates", () => {
    expect(validateSplit(100000.5, rows)).toBeNull();
    expect(validateSplit(0, rows)).toBe("Isi jumlah total dulu");
    expect(validateSplit(100, [rows[0]!])).toBe("Split minimal 2 baris");
    expect(validateSplit(100000, rows)).toBe("Jumlah baris harus sama dengan total");
    expect(validateSplit(1, [rows[0]!, { category_id: "b", amount: 0 }])).toBe(
      "Setiap baris harus punya jumlah > 0",
    );
    expect(validateSplit(2, [rows[0]!, { category_id: null, amount: 1 }])).toBe(
      "Setiap baris harus punya kategori",
    );
  });
  it("labels rows", () => {
    expect(splitDescription("Belanja", 0, 3)).toBe("Belanja (1/3)");
    expect(splitDescription("Belanja", 2, 3, "Sabun")).toBe("Sabun (3/3)");
    expect(splitDescription(null, 1, 2)).toBe("Split (2/2)");
  });
});

describe("rowsFromItems", () => {
  const items = [
    { name: "Beras", price: 70000 },
    { name: "Sabun", price: 15000 },
    { name: "Telur", price: 30000 },
    { name: "Gratis", price: null },
  ];
  const guess = (n: string) => (n === "Sabun" ? "rt" : "makan");
  it("groups by guessed category and sums", () => {
    expect(rowsFromItems(items, guess)).toEqual([
      { category_id: "makan", amount: 100000, note: "Beras, Telur" },
      { category_id: "rt", amount: 15000, note: "Sabun" },
    ]);
  });
  it("respects manual assignment and unknown categories", () => {
    const r = rowsFromItems(items, () => null, ["x", null, "x"]);
    expect(r).toEqual([
      { category_id: "x", amount: 100000, note: "Beras, Telur" },
      { category_id: null, amount: 15000, note: "Sabun" },
    ]);
  });
  it("balances leftover onto the last row", () => {
    const r = balanceLastRow(110000, rowsFromItems(items, guess));
    expect(r[1]!.amount).toBe(10000);
    expect(splitRemaining(110000, r)).toBe(0);
    const neg = [
      { category_id: "a", amount: 500 },
      { category_id: "b", amount: 50 },
    ];
    expect(balanceLastRow(100, neg)).toBe(neg);
  });
});
