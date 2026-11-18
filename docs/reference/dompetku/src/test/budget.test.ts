import { describe, expect, it } from "vitest";
import {
  budgetAlertText,
  budgetPercent,
  crossedLevels,
  rolloverCarry,
  rolloverStart,
} from "../lib/budget";

describe("rolloverStart", () => {
  it("starts at the created month when within 12 months", () => {
    expect(rolloverStart("2026-10", "2026-07")).toBe("2026-07");
  });
  it("caps the chain at 12 months back", () => {
    expect(rolloverStart("2026-10", "2020-01")).toBe("2025-10");
    expect(rolloverStart("2026-10", null)).toBe("2025-10");
  });
});

describe("rolloverCarry", () => {
  const spent = new Map([
    ["2026-08", 800_000],
    ["2026-09", 1_500_000],
  ]);
  it("is 0 in the creation month", () => {
    expect(rolloverCarry(1_000_000, "2026-08", "2026-08", spent)).toBe(0);
  });
  it("carries unused amount forward", () => {
    expect(rolloverCarry(1_000_000, "2026-09", "2026-08", spent)).toBe(200_000);
  });
  it("chains and carries overspending as negative", () => {
    // Aug: +200k, Sep: 1.2M effective − 1.5M = −300k
    expect(rolloverCarry(1_000_000, "2026-10", "2026-08", spent)).toBe(-300_000);
  });
  it("months without spending carry the full amount", () => {
    expect(rolloverCarry(100, "2026-10", "2026-07", new Map())).toBe(300);
  });
});

describe("budgetPercent", () => {
  it("uses the effective limit", () => {
    expect(budgetPercent(500, 2000, 1000)).toBe(25);
  });
  it("treats a non-positive effective limit as exhausted", () => {
    expect(budgetPercent(0, 0, 1000)).toBe(100);
    expect(budgetPercent(500, -100, 1000)).toBe(150);
  });
});

describe("crossedLevels", () => {
  it("detects warning and limit crossings", () => {
    expect(crossedLevels(70, 85, 80)).toEqual([80]);
    expect(crossedLevels(85, 101, 80)).toEqual([100]);
    expect(crossedLevels(10, 120, 80)).toEqual([80, 100]);
    expect(crossedLevels(81, 90, 80)).toEqual([]);
    expect(crossedLevels(100, 130, 80)).toEqual([]);
  });
  it("respects a custom alert percent", () => {
    expect(crossedLevels(50, 65, 60)).toEqual([80]);
    expect(crossedLevels(50, 65, 70)).toEqual([]);
    expect(crossedLevels(90, 100, 100)).toEqual([100]);
  });
});

describe("budgetAlertText", () => {
  it("formats both levels", () => {
    const base = {
      budget_id: "b",
      category: "Makan",
      percent: 85.4,
      spent: 850_000,
      effective: 1_000_000,
      alert_percent: 80,
    };
    expect(budgetAlertText({ ...base, level: 80 })).toMatch(/^🟠 Budget Makan sudah 85%/);
    expect(budgetAlertText({ ...base, level: 100, percent: 110 })).toMatch(
      /^🔴 Budget Makan terlampaui: 110%/,
    );
  });
});
