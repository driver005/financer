import { describe, expect, it } from "vitest";
import { buildPreview, parseAmount, parseCsv, parseDate } from "@/lib/csv";
import { buildReminderEmail } from "@/lib/email";

describe("csv", () => {
  it("parses quotes and semicolons", () => {
    expect(parseCsv('a;b\n"x;1";"he said ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x;1", 'he said "hi"'],
    ]);
  });
  it("parses amounts", () => {
    expect(parseAmount("Rp 25.000")).toBe(25000);
    expect(parseAmount("1.234,50")).toBe(1234.5);
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("-50000")).toBe(-50000);
    expect(parseAmount("abc")).toBeNull();
  });
  it("parses dates", () => {
    expect(parseDate("2026-10-03")).toBe("2026-10-03");
    expect(parseDate("03/10/2026")).toBe("2026-10-03");
    expect(parseDate("31/02/2026")).toBeNull();
  });
  it("builds preview with errors", () => {
    const { rows, missingHeaders } = buildPreview(
      parseCsv(
        "tanggal,jenis,jumlah,kategori,akun,catatan,mata uang\n2026-10-01,keluar,25000,Makan,GoPay,kopi,IDR\nxx,masuk,0,,,,EUR",
      ),
    );
    expect(missingHeaders).toEqual([]);
    expect(rows[0]?.value).toMatchObject({
      kind: "expense",
      amount: 25000,
      category: "Makan",
      account: "GoPay",
    });
    expect(rows[1]?.errors.length).toBe(3);
  });
});

describe("email", () => {
  it("builds subject/html", () => {
    const e = buildReminderEmail([
      {
        type: "debt",
        title: "Cicilan <A>",
        amount: 100000,
        currency: "IDR",
        due_date: "2026-10-05",
        days_left: -2,
        overdue: true,
      },
    ]);
    expect(e.subject).toContain("1 pengingat");
    expect(e.html).toContain("&lt;A&gt;");
    expect(e.text).toContain("Terlambat 2 hari");
  });
});
