import type { Scope } from "./types";

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function weekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function periodKey(scope: Scope, date = new Date()): string {
  return scope === "week" ? weekKey(date) : monthKey(date);
}

export function periodLabel(scope: Scope, key: string): string {
  if (scope === "month") {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  return key.replace("-W", ", week ");
}

export function shiftPeriod(scope: Scope, key: string, by: number): string {
  if (scope === "month") {
    const [y, m] = key.split("-").map(Number);
    return monthKey(new Date(y, m - 1 + by, 1));
  }
  const [y, w] = key.split("-W").map(Number);
  const d = new Date(y, 0, 1 + (w - 1 + by) * 7);
  return weekKey(d);
}
