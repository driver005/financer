import { describe, expect, it } from "vitest";
import {
  clampMessage,
  isValidDate,
  parseAmount,
  parseCallback,
  pickerKeyboard,
  previewKeyboard,
  quickParse,
  resolvePeriod,
  TELEGRAM_TEXT_MAX,
  undoKeyboard,
} from "../lib/bot";

const T = "2026-10-03";
const ACC = ["BCA", "Bank Jago", "Cash", "Dana", "GoPay", "Jago", "Mandiri"];
const qp = (s: string) => quickParse(s, T, ACC);

describe("quickParse — nominal", () => {
  it("angka kuantitas tidak mengalahkan nominal ber-satuan", () => {
    expect(qp("beli 2 kopi 25rb")).toMatchObject({ amount: 25000, description: "Beli 2 kopi" });
    expect(qp("makan bareng 2 orang 100rb")).toMatchObject({ amount: 100000 });
  });
  it("desimal dengan titik atau koma", () => {
    expect(qp("bensin 1.5jt")?.amount).toBe(1_500_000);
    expect(qp("1.5jt bensin")?.amount).toBe(1_500_000);
    expect(qp("bensin 1,5jt")?.amount).toBe(1_500_000);
    expect(qp("bensin 1,5 jt")?.amount).toBe(1_500_000);
    expect(qp("kopi 2,5k")?.amount).toBe(2500);
    expect(qp("kopi 25k")?.amount).toBe(25000);
  });
  it("format rupiah", () => {
    expect(qp("Rp 25.000,50 kopi")).toMatchObject({ amount: 25000.5, currency: "IDR" });
    expect(qp("kopi 25.000")?.amount).toBe(25000);
    expect(qp("kopi 25,000")?.amount).toBe(25000);
    expect(qp("kopi 25.000.000")?.amount).toBe(25_000_000);
    expect(qp("kopi rp25rb")?.amount).toBe(25000);
  });
  it("USD", () => {
    expect(qp("kopi $5")).toMatchObject({ amount: 5, currency: "USD" });
    expect(qp("kopi 5 usd")).toMatchObject({ amount: 5, currency: "USD" });
    expect(qp("netflix $15.99")).toMatchObject({ amount: 15.99, currency: "USD" });
    expect(qp("netflix $15,99")).toMatchObject({ amount: 15.99, currency: "USD" });
    expect(qp("laptop $1,299")).toMatchObject({ amount: 1299, currency: "USD" });
  });
  it("kasus tepi", () => {
    expect(qp("")).toBeNull();
    expect(qp("   ")).toBeNull();
    expect(qp("kopi 0")).toBeNull();
    expect(qp("kopi 25rb 30rb")).toBeNull(); // dua nominal kuat → ambigu
    expect(qp("kopi 99999999999999999")).toBeNull(); // di luar numeric(18,2)
    // tanda minus diabaikan: tetap pengeluaran positif
    expect(qp("kopi -25rb")).toMatchObject({ amount: 25000, kind: "expense" });
  });
  it("parseAmount", () => {
    expect(parseAmount("250.000")).toBe(250000);
    expect(parseAmount("1.5", "jt")).toBe(1_500_000);
    expect(parseAmount("1.500", "rb")).toBe(1_500_000);
    expect(parseAmount("abc")).toBe(0);
  });
});

describe("quickParse — akun yang mirip kata biasa", () => {
  it("nama akun di akhir dipakai sebagai akun", () => {
    expect(qp("makan 30rb cash")).toMatchObject({ account: "Cash", description: "Makan" });
    expect(qp("gojek 20rb gopay")).toMatchObject({ account: "GoPay", description: "Gojek" });
    expect(qp("makan 30rb pake cash")).toMatchObject({ account: "Cash" });
    expect(qp("kopi 25rb ke bank jago")).toMatchObject({ account: "Bank Jago" });
    expect(qp("kopi 25rb bank jago")).toMatchObject({ account: "Bank Jago" });
    expect(qp("kopi 25rb pakai bca")).toMatchObject({ account: "BCA" });
  });
  it("'dana' sebagai kata biasa tidak dianggap akun", () => {
    expect(qp("dana darurat 500rb")).toMatchObject({ account: null, description: "Dana darurat" });
    expect(qp("bayar dana 50rb")).toMatchObject({ account: null });
    expect(qp("topup jago 100rb")).toMatchObject({ account: null });
  });
});

describe("tanggal & periode", () => {
  it("menolak tanggal yang tidak ada", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2026-02-31")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(resolvePeriod("2026-13", T)).toBeNull();
    expect(resolvePeriod("2026-02-31", T)).toBeNull();
    expect(resolvePeriod("2026-02-28", T)).toMatchObject({
      start: "2026-02-28",
      end: "2026-03-01",
    });
  });
});

describe("batas Telegram", () => {
  const id = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");
  it("callback_data ≤ 64 byte (UTF-8) di semua keyboard", () => {
    const names = Array.from(
      { length: 60 },
      (_, i) => `Kategori 🍜 sangat panjang sekali nomor ${i}`,
    );
    const all = [
      ...previewKeyboard(id).inline_keyboard.flat(),
      ...pickerKeyboard(id, "C", names, { text: "x", idx: 999 }).inline_keyboard.flat(),
      ...undoKeyboard(id).inline_keyboard.flat(),
    ];
    for (const b of all) {
      expect(bytes(b.callback_data)).toBeLessThanOrEqual(64);
      expect(parseCallback(b.callback_data)).not.toBeNull();
    }
  });
  it("label tombol tidak memotong emoji di tengah", () => {
    const kb = pickerKeyboard(id, "C", ["🍜".repeat(40)]);
    expect(kb.inline_keyboard[0]![0]!.text).toBe("🍜".repeat(30));
  });
  it("pesan dipotong ≤ 4096 karakter di batas baris", () => {
    const long = Array.from({ length: 500 }, (_, i) => `• baris ${i} — Rp 25.000 [Makanan]`).join(
      "\n",
    );
    const out = clampMessage(long);
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX);
    expect(out).toContain("terpotong");
    expect(clampMessage("pendek")).toBe("pendek");
    const noNl = clampMessage("x".repeat(10_000));
    expect(noNl.length).toBeLessThanOrEqual(TELEGRAM_TEXT_MAX);
  });
});
