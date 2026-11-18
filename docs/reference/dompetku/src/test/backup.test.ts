import { describe, expect, it } from "vitest";
import {
  RESTORE_TABLES,
  applyRemap,
  backupFilename,
  chunkRows,
  dedupeRows,
  dropColumn,
  missingColumn,
  parseBackup,
  resolveNaturalKeys,
  stripGenerated,
} from "@/lib/backup";
import { activityDetail, activityLabel } from "@/lib/activity";

const file = (data: Record<string, unknown[]>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    exportedAt: "2026-10-01T00:00:00Z",
    app: "dompetku",
    version: 1,
    data,
    ...extra,
  });

describe("parseBackup", () => {
  it("groups tables in FK-safe order and ignores bot_drafts/activity_log/unknown", () => {
    const r = parseBackup(
      file({
        transactions: [{ id: "t1" }],
        accounts: [{ id: "a1" }, { id: "a2" }],
        activity_log: [{ id: "x" }],
        bot_drafts: [{ id: "y" }],
        foo: [],
        gold_prices: [{ price_date: "2026-10-01", source: "antam" }],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.tables.map((t) => t.table)).toEqual([
      "accounts",
      "transactions",
      "gold_prices",
    ]);
    expect(r.backup.ignored.sort()).toEqual(["activity_log", "bot_drafts", "foo"]);
    expect(r.backup.total).toBe(4);
    expect(r.backup.exportedAt).toBe("2026-10-01T00:00:00Z");
  });
  it("puts transactions before tables that reference them", () => {
    const i = (t: string) => (RESTORE_TABLES as readonly string[]).indexOf(t);
    for (const t of ["gold_purchases", "receivables", "debt_payments", "receivable_payments"])
      expect(i("transactions")).toBeLessThan(i(t));
    expect(i("debts")).toBeLessThan(i("debt_payments"));
    expect(i("receivables")).toBeLessThan(i("receivable_payments"));
    expect(i("categories")).toBeLessThan(i("budgets"));
    expect(i("accounts")).toBeLessThan(i("recurring_transactions"));
    expect(i("categories")).toBeLessThan(i("recurring_transactions"));
    expect(i("budgets")).toBeLessThan(i("budget_alerts"));
    expect(i("accounts")).toBeLessThan(i("account_reconciliations"));
    expect(i("accounts")).toBeLessThan(i("app_settings"));
  });
  it("rejects invalid input", () => {
    expect(parseBackup("{nope").ok).toBe(false);
    expect(parseBackup(file({}, { app: "other" }))).toEqual({
      ok: false,
      error: "Bukan berkas cadangan Dompetku",
    });
    expect(parseBackup(file({}, { version: 2 })).ok).toBe(false);
    expect(parseBackup(file({ accounts: [{ name: "BCA" }] })).ok).toBe(false);
    expect(parseBackup(file({ fx_rates: [{ rate_date: "2026-01-01", base: "USD" }] })).ok).toBe(
      false,
    );
  });
  it("accepts parsed objects and the n8n endpoint shape", () => {
    const r = parseBackup({ ok: true, filename: "x.json", app: "dompetku", version: 1, data: {} });
    expect(r.ok).toBe(true);
  });
});

describe("restore helpers", () => {
  it("chunks by rows and bytes", () => {
    const rows = Array.from({ length: 1203 }, (_, i) => ({ id: String(i) }));
    expect(chunkRows(rows).map((c) => c.length)).toEqual([500, 500, 203]);
    const big = [{ s: "x".repeat(60) }, { s: "x".repeat(60) }, { s: "x".repeat(60) }];
    expect(chunkRows(big, 500, 150).map((c) => c.length)).toEqual([2, 1]);
    expect(chunkRows([])).toEqual([]);
  });
  it("remaps natural keys and rewrites foreign keys", () => {
    const { rows, remapped } = resolveNaturalKeys(
      "categories",
      [
        { id: "old", name: "Makan", kind: "expense" },
        { id: "new", name: "Baru", kind: "expense" },
      ],
      [{ id: "db1", name: "Makan", kind: "expense" }],
    );
    expect(remapped).toEqual({ old: "db1" });
    expect(rows[0]!["id"]).toBe("db1");
    expect(rows[1]!["id"]).toBe("new");
    const tx = applyRemap("transactions", [{ id: "t", category_id: "old", account_id: "a" }], {
      categories: remapped,
    });
    expect(tx[0]).toEqual({ id: "t", category_id: "db1", account_id: "a" });
    expect(resolveNaturalKeys("accounts", [{ id: "a" }], []).remapped).toEqual({});
    // null natural key (transaction without external_id) is untouched
    expect(
      resolveNaturalKeys(
        "transactions",
        [{ id: "t", external_id: null }],
        [{ id: "z", external_id: null }],
      ).remapped,
    ).toEqual({});
  });
  it("dedupes rows by primary and natural key (last wins)", () => {
    expect(
      dedupeRows("accounts", [
        { id: "a", name: "1" },
        { id: "a", name: "2" },
      ]),
    ).toEqual([{ id: "a", name: "2" }]);
    expect(
      dedupeRows("budgets", [
        { id: "b1", category_id: "c" },
        { id: "b2", category_id: "c" },
      ]),
    ).toEqual([{ id: "b2", category_id: "c" }]);
    expect(
      dedupeRows("fx_rates", [
        { rate_date: "d", base: "USD", quote: "IDR", rate: 1 },
        { rate_date: "d", base: "USD", quote: "IDR", rate: 2 },
      ]),
    ).toHaveLength(1);
  });
  it("strips generated columns and remaps budget alerts", () => {
    expect(
      stripGenerated("transactions", [
        { id: "t", items_search: "kopi", split_group: "g", receipt_paths: ["a"] },
      ]),
    ).toEqual([{ id: "t", split_group: "g", receipt_paths: ["a"] }]);
    const rows = [{ id: "a", name: "x" }];
    expect(stripGenerated("accounts", rows)).toBe(rows);
    expect(
      applyRemap("budget_alerts", [{ id: "x", budget_id: "b-old" }], {
        budgets: { "b-old": "b-db" },
      }),
    ).toEqual([{ id: "x", budget_id: "b-db" }]);
  });
  it("detects unknown columns and drops them", () => {
    expect(
      missingColumn({
        message: "Could not find the 'tax_percent' column of 'subscriptions' in the schema cache",
      }),
    ).toBe("tax_percent");
    expect(missingColumn({ message: 'column "foo" of relation "accounts" does not exist' })).toBe(
      "foo",
    );
    expect(missingColumn({ message: "duplicate key" })).toBeNull();
    expect(dropColumn([{ a: 1, b: 2 }], "b")).toEqual([{ a: 1 }]);
  });
  it("names files and labels activity", () => {
    expect(backupFilename(new Date("2026-10-04T10:00:00Z"))).toBe(
      "dompetku-cadangan-2026-10-04.json",
    );
    expect(activityLabel("backup.restore")).toBe("Cadangan dipulihkan");
    expect(activityDetail({ restored: 12 }, () => "")).toBe("12 baris");
  });
});
