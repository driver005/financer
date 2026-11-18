import { describe, expect, it, vi } from "vitest";

// Stub db(): fx_rates mengembalikan kurs tersimpan; insert transaksi pertama
// gagal karena kolom receipt_path belum ada, lalu berhasil tanpa kolom itu.
const inserted: Record<string, unknown>[] = [];
vi.mock("../lib/db.server", () => ({
  db: () => ({
    from: (table: string) => {
      if (table === "fx_rates") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: { rate: 16000 }, error: null }) }),
              }),
            }),
          }),
        };
      }
      return {
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              inserted.push(row);
              if ("receipt_path" in row)
                return {
                  data: null,
                  error: {
                    message:
                      "Could not find the 'receipt_path' column of 'transactions' in the schema cache",
                  },
                };
              return { data: { id: "tx-1", ...row }, error: null };
            },
          }),
        }),
      };
    },
  }),
}));

import { insertTransaction } from "../lib/finance.server";

describe("fallback receipt_path", () => {
  it("mengulang insert tanpa receipt_path saat kolom belum ada di database", async () => {
    const tx = await insertTransaction({
      kind: "expense",
      amount: 100,
      currency: "IDR",
      account_id: null,
      to_account_id: null,
      category_id: null,
      description: "Bayar langganan",
      merchant: null,
      occurred_at: "2026-10-03",
      source: "web",
      items: null,
      notes: null,
      receipt_path: null,
    });
    expect(tx.id).toBe("tx-1");
    expect(inserted).toHaveLength(2);
    expect("receipt_path" in inserted[0]!).toBe(true);
    expect("receipt_path" in inserted[1]!).toBe(false);
  });
});
