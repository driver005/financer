/** Client-safe CSV parsing + row normalization for transaction import. */

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim =
    (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export function parseAmount(raw: string): number | null {
  let s = raw.replace(/rp|idr|usd|\$|\s/gi, "");
  if (!s) return null;
  const neg = s.startsWith("-") || /^\(.*\)$/.test(s);
  s = s.replace(/[-()]/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    s = s.split(thou).join("").replace(dec, ".");
  } else {
    const sep = lastDot >= 0 ? "." : lastComma >= 0 ? "," : null;
    if (sep) {
      const parts = s.split(sep);
      const thousands = parts.length > 2 || parts[parts.length - 1]?.length === 3;
      s = thousands ? parts.join("") : parts.join(".");
    }
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let y: number, mo: number, d: number;
  if (m) {
    y = +m[1]!;
    mo = +m[2]!;
    d = +m[3]!;
  } else {
    m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (!m) return null;
    d = +m[1]!;
    mo = +m[2]!;
    y = +m[3]!;
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const KIND: Record<string, "income" | "expense"> = {
  income: "income",
  masuk: "income",
  pemasukan: "income",
  in: "income",
  expense: "expense",
  keluar: "expense",
  pengeluaran: "expense",
  out: "expense",
};

const HEADERS: Record<string, string[]> = {
  date: ["tanggal", "date", "tgl"],
  kind: ["jenis", "kind", "type", "tipe"],
  amount: ["jumlah", "amount", "nominal"],
  category: ["kategori", "category"],
  account: ["akun", "account", "dompet"],
  notes: ["catatan", "notes", "note", "deskripsi", "description", "keterangan"],
  currency: ["mata uang", "currency", "matauang", "mata_uang"],
};

export type ImportRow = {
  date: string;
  kind: "income" | "expense";
  amount: number;
  currency: "IDR" | "USD";
  category: string | null;
  account: string | null;
  notes: string | null;
};
export type PreviewRow = {
  line: number;
  raw: string[];
  value: ImportRow | null;
  errors: string[];
  duplicate: boolean;
};

/** Fingerprint used to detect duplicate rows (same date, kind, amount, currency, notes). */
export function dupKey(row: {
  date: string;
  kind: string;
  amount: number;
  currency: string;
  description?: string | null;
}): string {
  return `${row.date}|${row.kind}|${Number(row.amount)}|${row.currency}|${(row.description ?? "").toLowerCase().trim()}`;
}

export function buildPreview(table: string[][]): { rows: PreviewRow[]; missingHeaders: string[] } {
  const [head = [], ...body] = table;
  const norm = head.map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(HEADERS))
    idx[key] = norm.findIndex((h) => aliases.includes(h));
  const missingHeaders = ["date", "amount"].filter((k) => idx[k]! < 0).map((k) => HEADERS[k]![0]!);
  const get = (r: string[], k: string) => (idx[k]! >= 0 ? (r[idx[k]!] ?? "").trim() : "");
  const seen = new Set<string>();
  const rows = body.map((r, i): PreviewRow => {
    const errors: string[] = [];
    const date = parseDate(get(r, "date"));
    if (!date) errors.push("tanggal tidak valid");
    let amount = parseAmount(get(r, "amount"));
    const kindRaw = get(r, "kind").toLowerCase();
    let kind = KIND[kindRaw];
    if (kindRaw && !kind) errors.push(`jenis "${kindRaw}" tidak dikenal`);
    if (amount == null || amount === 0) errors.push("jumlah tidak valid");
    else if (amount < 0) {
      amount = -amount;
      kind = kind ?? "expense";
    }
    const cur = (get(r, "currency") || "IDR").toUpperCase();
    if (cur !== "IDR" && cur !== "USD") errors.push(`mata uang "${cur}" tidak didukung`);
    const value: ImportRow | null = errors.length
      ? null
      : {
          date: date!,
          kind: kind ?? "expense",
          amount: amount!,
          currency: cur as "IDR" | "USD",
          category: get(r, "category") || null,
          account: get(r, "account") || null,
          notes: get(r, "notes") || null,
        };
    let duplicate = false;
    if (value) {
      const key = dupKey({
        date: value.date,
        kind: value.kind,
        amount: value.amount,
        currency: value.currency,
        description: value.notes,
      });
      if (seen.has(key)) duplicate = true;
      seen.add(key);
    }
    return { line: i + 2, raw: r, value, errors, duplicate };
  });
  return { rows, missingHeaders };
}
