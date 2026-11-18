/**
 * Native (Hermes) fallback for the Rust/WASM core.
 * Hermes has no WebAssembly engine, so on device the same API is implemented here.
 * Web still uses the Rust module in core.ts.
 */
type Scope = "week" | "month";
type Recipe = Record<string, any>;

function monthKey(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function weekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
function periodKey(scope: Scope, date: Date): string { return scope === "week" ? weekKey(date) : monthKey(date); }
function periodLabel(scope: Scope, key: string): string {
  if (scope === "month") { const [y, m] = key.split("-"); return `${new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en", { month: "long" })} ${y}`; }
  return key.replace("-W", ", week ");
}
function shiftPeriod(scope: Scope, key: string, by: number): string {
  if (scope === "month") { const [y, m] = key.split("-").map(Number); return monthKey(new Date(y, m - 1 + by, 1)); }
  const [y, w] = key.split("-W").map(Number);
  return weekKey(new Date(y, 0, 1 + (w - 1 + by) * 7));
}
function parseEuro(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
function formatEuro(cents: number): string {
  return `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2 }).format(cents / 100)} €`;
}
function scaleAmount(text: string, servings: number, base: number): string {
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!match || base <= 0) return text;
  const value = (Number(match[1].replace(",", ".")) * servings) / base;
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
  return `${rounded}${match[2] ? ` ${match[2]}` : ""}`;
}
function parseTransactionCsv(text: string): { rows: Row[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const delimiter = lines[0]?.includes(";") ? ";" : lines[0]?.includes("\t") ? "\t" : ",";
  const rows: Row[] = [], errors: string[] = [];
  lines.slice(1).forEach((line, index) => {
    const parts = line.split(delimiter).map((part) => part.trim().replace(/^"|"$/g, ""));
    const cents = parseEuro(parts[2] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[0] ?? "") || !parts[1] || cents === null) { errors.push(`Line ${index + 2}`); return; }
    rows.push({ date: parts[0], merchant: parts[1], amountCents: Math.abs(cents), category: parts[3] || "uncategorised", storeId: null, source: "csv", externalId: null });
  });
  return { rows, errors };
}
const SUPERMARKETS = [
  { id: "rewe", name: "REWE", aliases: "rewe, rewe markt, rewe center, rewe to go, rewe ebon", active: 1 },
  { id: "kaufland", name: "Kaufland", aliases: "kaufland, kaufland card", active: 1 },
  { id: "lidl", name: "Lidl", aliases: "lidl, lidl plus, lidl markt", active: 1 },
  { id: "aldi", name: "Aldi", aliases: "aldi, aldi nord, aldi sud, aldi süd", active: 1 },
  { id: "penny", name: "Penny", aliases: "penny, penny markt", active: 1 },
  { id: "netto", name: "Netto", aliases: "netto, netto marken-discount, neto", active: 1 },
];
function matchStore(merchant: string, stores: Row[]): string | null {
  const text = merchant.toLowerCase();
  for (const store of stores) {
    if (!store.active) continue;
    if (s(store.aliases).split(",").map((a) => a.trim().toLowerCase()).some((a) => a && text.includes(a))) return s(store.id);
  }
  return null;
}
function parseOffers(text: string, storeId: string, source = "paste"): Row[] {
  const today = new Date(), until = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return text.split(/\r?\n/).map((line) => line.trim().replace(/^[-*•]\s*/, "")).filter(Boolean).map((line) => {
    const match = line.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)?\s*$/i);
    if (!match || match.index === undefined) return null;
    const product = line.slice(0, match.index).replace(/^[^:]+:\s*/, "").trim();
    if (!product) return null;
    return { storeId, product, price: `${match[1].replace(".", ",")} €`, note: "", validFrom: iso(today), validTo: iso(until), source, createdAt: Date.now() };
  }).filter(Boolean) as Row[];
}
function storeSummary(rows: Row[], storeId: string, month = monthKey(new Date())) {
  const matched = rows.filter((r) => r.storeId === storeId && s(r.date).startsWith(month));
  const total = matched.reduce((a, r) => a + cents(r), 0);
  return { visits: matched.length, total, average: matched.length ? Math.round(total / matched.length) : 0 };
}
function normalizeMeal(meal: Row): Recipe {
  const ingredients: Row[] = [];
  for (let i = 1; i <= 20; i++) { const name = s(meal[`strIngredient${i}`]).trim(); if (!name) continue; ingredients.push({ name, amount: s(meal[`strMeasure${i}`]).trim() || "1" }); }
  const steps = s(meal.strInstructions).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return { id: s(meal.idMeal), title: s(meal.strMeal), summary: `${s(meal.strArea)} · ${s(meal.strCategory)}`,
    image: meal.strMealThumb, category: s(meal.strCategory), area: s(meal.strArea), minutes: 30, servings: 2,
    ingredients, steps: steps.length ? steps : ["Prepare the ingredients, then cook until done."], source: "themealdb" };
}

type Row = Record<string, any>;
const arr = (value: unknown): Row[] => (Array.isArray(value) ? value : []) as Row[];
const n = (value: unknown): number => Number(value ?? 0);
const s = (value: unknown): string => String(value ?? "");
const cents = (row: Row): number => n(row.amountCents ?? row.cents ?? 0);
const todayIso = () => new Date().toISOString().slice(0, 10);

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64encode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    const v = (a << 16) | (b << 8) | c;
    out += B64[(v >> 18) & 63] + B64[(v >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(v >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? B64[v & 63] : "=";
  }
  return out;
}
function b64decode(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let j = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]), b = B64.indexOf(clean[i + 1]);
    const c = clean[i + 2] === "=" ? 0 : B64.indexOf(clean[i + 2]);
    const d = clean[i + 3] === "=" ? 0 : B64.indexOf(clean[i + 3]);
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    if (j < out.length) out[j++] = (v >> 16) & 255;
    if (j < out.length && clean[i + 2] !== "=") out[j++] = (v >> 8) & 255;
    if (j < out.length && clean[i + 3] !== "=") out[j++] = v & 255;
  }
  return out;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function le16(v: number): number[] { return [v & 255, (v >> 8) & 255]; }
function le32(v: number): number[] { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255]; }
function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const out: number[] = [], central: number[] = [];
  for (const file of files) {
    const name = Array.from(new TextEncoder().encode(file.name));
    const crc = crc32(file.data), offset = out.length;
    out.push(...le32(0x04034b50), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0),
      ...le32(crc), ...le32(file.data.length), ...le32(file.data.length), ...le16(name.length), ...le16(0), ...name, ...file.data);
    central.push(...le32(0x02014b50), ...le16(20), ...le16(20), ...le16(0), ...le16(0), ...le16(0), ...le16(0),
      ...le32(crc), ...le32(file.data.length), ...le32(file.data.length), ...le16(name.length), ...le16(0), ...le16(0),
      ...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...name);
  }
  const start = out.length;
  out.push(...central, ...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(files.length), ...le16(files.length),
    ...le32(central.length), ...le32(start), ...le16(0));
  return new Uint8Array(out);
}
function unzipStored(bytes: Uint8Array): { name: string; data: Uint8Array }[] {
  const out: { name: string; data: Uint8Array }[] = [];
  let o = 0;
  const u32 = (p: number) => bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24);
  const u16 = (p: number) => bytes[p] | (bytes[p + 1] << 8);
  while (o + 30 <= bytes.length) {
    const sig = u32(o);
    if (sig === 0x02014b50 || sig === 0x06054b50 || sig !== 0x04034b50) break;
    const method = u16(o + 8), size = u32(o + 18), nameLen = u16(o + 26), extraLen = u16(o + 28);
    const start = o + 30 + nameLen + extraLen;
    if (method !== 0 || start + size > bytes.length) break;
    out.push({ name: new TextDecoder().decode(bytes.subarray(o + 30, o + 30 + nameLen)), data: bytes.subarray(start, start + size) });
    o = start + size;
  }
  return out;
}
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (v: string) => v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');

function txTotals(rows: Row[], prefix: string) {
  let income = 0, expense = 0;
  for (const row of rows) {
    if (prefix && !s(row.date).startsWith(prefix)) continue;
    const kind = s(row.kind || "expense");
    if (kind === "income") income += cents(row);
    else if (kind !== "transfer") expense += cents(row);
  }
  return { income, expense, balance: income - expense };
}
function categoryTotals(rows: Row[], prefix: string) {
  const map: Record<string, number> = {};
  for (const row of rows) {
    if (prefix && !s(row.date).startsWith(prefix)) continue;
    if (row.kind === "income" || row.kind === "transfer") continue;
    const key = s(row.category || "uncategorised");
    map[key] = (map[key] ?? 0) + cents(row);
  }
  return Object.entries(map).map(([category, c]) => ({ category, cents: c })).sort((a, b) => b.cents - a.cents);
}
function budgetStatus(budgets: Row[], spending: Row[]) {
  const spent: Record<string, number> = {};
  for (const row of spending) spent[s(row.category)] = (spent[s(row.category)] ?? 0) + n(row.cents);
  return budgets.map((b) => {
    const limit = n(b.limitCents), used = spent[s(b.category)] ?? 0;
    return { category: s(b.category), limit, spent: used, remaining: limit - used, percent: limit ? Math.round((used * 100) / limit) : 0 };
  });
}
function dateToZ(date: string): number { const [y, m, d] = date.split("-").map(Number); return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1) / 86400000); }
function zToDate(z: number): string { const d = new Date(z * 86400000); return d.toISOString().slice(0, 10); }
function weekday(date: string): string { return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(`${date}T12:00:00Z`).getUTCDay()]; }
function nextWeekday(from: string, target: string): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const delta = (names.indexOf(target) - new Date(`${from}T12:00:00Z`).getUTCDay() + 7) % 7;
  return zToDate(dateToZ(from) + delta);
}
function priceSeries(prices: Row[], name: string, store: string) {
  return prices.filter((p) => s(p.name).toLowerCase() === name.toLowerCase() && s(p.storeId) === store)
    .sort((a, b) => s(a.date).localeCompare(s(b.date)))
    .map((p) => ({ date: s(p.date), cents: n(p.cents) }));
}
function stats(prices: Row[], name: string, store: string) {
  const series = priceSeries(prices, name, store);
  const values = series.map((p) => p.cents);
  const current = values[values.length - 1] ?? 0;
  return { current, min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0,
    avg: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0, series };
}
function forecast(rows: Row[], name: string, store: string, today = todayIso()) {
  const series = priceSeries(rows, name, store);
  const totals: Record<string, number> = {}, counts: Record<string, number> = {};
  for (const p of series) { const day = weekday(p.date); totals[day] = (totals[day] ?? 0) + p.cents; counts[day] = (counts[day] ?? 0) + 1; }
  let best = "Monday", bestAvg = Infinity;
  for (const day of Object.keys(counts)) { const avg = totals[day] / counts[day]; if (avg < bestAvg) { bestAvg = avg; best = day; } }
  const current = series[series.length - 1]?.cents ?? 0;
  const min = series.length ? Math.min(...series.map((p) => p.cents)) : 0;
  return { weekday: best, nextDate: nextWeekday(today, best), expectedCents: Math.round(bestAvg || 0), buyNow: current <= min + 5, samples: series.length };
}
function csv(rows: Row[]) {
  const head = "date;merchant;amount;category;kind;account\n";
  return head + rows.map((r) => [s(r.date), s(r.merchant), `${n(r.amountCents) / 100},${String(Math.abs(n(r.amountCents)) % 100).padStart(2, "0")}`,
    s(r.category), s(r.kind), s(r.accountId)].map((v) => v.replace(/;/g, ",")).join(";")).join("\n") + "\n";
}
function pdf(rows: Row[], title: string) {
  const lines = [title, `Expense ${formatEuro(txTotals(rows, "").expense)}`, "TRANSACTIONS",
    ...rows.map((r) => `${s(r.date)} ${s(r.merchant)} ${formatEuro(cents(r))}`)];
  let content = "BT /F1 11 Tf 48 790 Td 15 TL\n";
  for (const line of lines) content += `(${line.replace(/[\\()]/g, "\\$&")}) Tj T*\n`;
  content += "ET\n";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let out = "%PDF-1.4\n"; const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return b64encode(new TextEncoder().encode(out));
}
function xlsx(rows: Row[]) {
  const cell = (col: string, row: number, value: string) => `<c r="${col}${row}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
  let sheet = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  sheet += `<row r="1">${["Date", "Merchant", "Amount", "Category"].map((h, i) => cell(String.fromCharCode(65 + i), 1, h)).join("")}</row>`;
  rows.forEach((r, i) => {
    const row = i + 2;
    const values = [s(r.date), s(r.merchant), `${n(r.amountCents) / 100}`, s(r.category)];
    sheet += `<row r="${row}">${values.map((v, j) => cell(String.fromCharCode(65 + j), row, v)).join("")}</row>`;
  });
  sheet += "</sheetData></worksheet>";
  const enc = (v: string) => new TextEncoder().encode(v);
  return b64encode(zipStore([
    { name: "[Content_Types].xml", data: enc('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>') },
    { name: "_rels/.rels", data: enc('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: "xl/workbook.xml", data: enc('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: "xl/_rels/workbook.xml.rels", data: enc('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: "xl/worksheets/sheet1.xml", data: enc(sheet) },
  ]));
}
function xlsxImport(base64: string): Row[] {
  const files = unzipStored(b64decode(base64));
  const sheet = files.find((f) => f.name === "xl/worksheets/sheet1.xml");
  if (!sheet) return [];
  const xml = new TextDecoder().decode(sheet.data);
  const out: Row[] = [];
  let first = true;
  for (const part of xml.split(/<row[^>]*>/).slice(1)) {
    const rowXml = part.split("</row>")[0];
    if (first) { first = false; continue; }
    const cells: string[] = [];
    let rest = rowXml;
    while (rest.indexOf("<t") >= 0) {
      rest = rest.slice(rest.indexOf("<t") + 2);
      const open = rest.indexOf(">"); if (open < 0) break;
      rest = rest.slice(open + 1);
      const close = rest.indexOf("</t>"); if (close < 0) break;
      cells.push(unesc(rest.slice(0, close))); rest = rest.slice(close + 4);
    }
    if (cells.length < 4) continue;
    out.push({ date: cells[0], merchant: cells[1], amountCents: Math.round(Number(cells[2].replace(",", ".")) * 100), category: cells[3], kind: cells[4] ?? "expense" });
  }
  return out;
}

export const coreFallback = {
  periodKey(scope: Scope, date: Date) { return periodKey(scope, date); },
  monthKey(date: Date) { return monthKey(date); },
  shiftPeriod(scope: Scope, key: string, by: number) { return shiftPeriod(scope, key, by); },
  periodLabel(scope: Scope, key: string) { return periodLabel(scope, key); },
  periodStartKey(date: Date, startDay: number) {
    const d = date.getDate() < startDay ? new Date(date.getFullYear(), date.getMonth() - 1, 1) : date;
    return monthKey(d);
  },
  periodStartShift(key: string, by: number) { const [y, m] = key.split("-").map(Number); return monthKey(new Date(y, m - 1 + by, 1)); },
  periodStartLabel(key: string, startDay: number) {
    const [y, m] = key.split("-").map(Number);
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y;
    return `${months[m - 1]} ${startDay} – ${months[nm - 1]} ${startDay - 1} ${ny}`;
  },
  parseEuro,
  formatEuro(cents: number) { return formatEuro(cents); },
  formatMoney(cents: number, code: string) { return formatEuro(cents).replace("€", code); },
  scaleAmount,
  supermarkets() { return SUPERMARKETS; },
  matchStore(merchant: string, stores: unknown) { return matchStore(merchant, arr(stores) as never); },
  parseOffers(text: string, storeId: string, today = todayIso(), source = "paste") { return parseOffers(text, storeId, source); },
  storeSummary(rows: unknown, storeId: string, month = todayIso().slice(0, 7)) { return storeSummary(rows as never, storeId, month); },
  parsePurchases(text: string, storeId: string) {
    return text.split(/\r?\n/).map((line) => line.trim().replace(/^[-*•]\s*/, "")).filter(Boolean).map((line) => {
      const parts = line.split(/\s+/);
      const last = parts[parts.length - 1];
      const isQty = /^\d+$/.test(last) && parts.length > 1;
      return { storeId, name: isQty ? parts.slice(0, -1).join(" ") : line, qty: isQty ? last : "1" };
    });
  },
  buildList(purchases: unknown, offers: unknown, scope: "week" | "month") {
    const offerRows = arr(offers);
    return arr(purchases).map((p) => {
      const name = s(p.name);
      const offer = offerRows.find((o) => { const product = s(o.product).toLowerCase(); return product && (name.toLowerCase().includes(product) || product.includes(name.toLowerCase())); });
      return { name, qty: s(p.qty || "1"), store: s(p.storeId),
        offerPrice: offer ? s(offer.price) : null, offerProduct: offer ? s(offer.product) : null };
    });
  },
  parseTransactionCsv(text: string) { return parseTransactionCsv(text); },
  reportCsv(rows: unknown) { return csv(arr(rows)); },
  csvExport(rows: unknown) { return csv(arr(rows)); },
  convert(cents: number, from: string, to: string, rates: unknown) {
    const list = arr(rates);
    const rateOf = (code: string) => n(list.find((r) => s(r.code).toUpperCase() === code.toUpperCase())?.rate);
    const a = rateOf(from), b = rateOf(to);
    return a > 0 ? Math.round((cents / a) * b) : null;
  },
  reportHtml(rows: unknown, title: string) {
    const totals = txTotals(arr(rows), "");
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1><p>Income ${formatEuro(totals.income)} · Expense ${formatEuro(totals.expense)} · Balance ${formatEuro(totals.balance)}</p><table>${arr(rows).map((r) => `<tr><td>${esc(s(r.date))}</td><td>${esc(s(r.merchant))}</td><td>${formatEuro(cents(r))}</td></tr>`).join("")}</table></body></html>`;
  },
  reportPdf(rows: unknown, title: string) { return pdf(arr(rows), title); },
  xlsx(rows: unknown) { return xlsx(arr(rows)); },
  xlsxImport(base64: string) { return xlsxImport(base64); },
  pinHash(pin: string) {
    let value = 1469598103934665603;
    for (let i = 0; i < 64; i++) { value ^= pin.charCodeAt(i % Math.max(1, pin.length)); value = Math.imul(value, 1099511628211) >>> 0; }
    return value.toString(16).padStart(16, "0");
  },
  txTotals(rows: unknown, prefix: string) { return txTotals(arr(rows), prefix); },
  categoryTotals(rows: unknown, prefix: string) { return categoryTotals(arr(rows), prefix); },
  budgetStatus(budgets: unknown, spending: unknown) { return budgetStatus(arr(budgets), arr(spending)); },
  groupCategories(rows: unknown, categories: unknown, prefix: string) {
    const parents: Record<string, string> = {};
    for (const c of arr(categories)) parents[s(c.name).toLowerCase()] = s(c.parent || c.name);
    const totals: Record<string, number> = {};
    for (const row of arr(rows)) {
      if (prefix && !s(row.date).startsWith(prefix)) continue;
      if (row.kind === "income" || row.kind === "transfer") continue;
      const key = s(row.category), root = parents[key.toLowerCase()] ?? key;
      totals[root] = (totals[root] ?? 0) + cents(row);
    }
    return Object.entries(totals).map(([category, c]) => ({ category, cents: c })).sort((a, b) => b.cents - a.cents);
  },
  filterTag(rows: unknown, tag: string) {
    return arr(rows).filter((r) => s(r.tags).toLowerCase().split(/[, ]+/).includes(tag.trim().toLowerCase()));
  },
  geoSummary(rows: unknown) {
    const groups: Record<string, { latitude: number; longitude: number; visits: number; total: number }> = {};
    for (const row of arr(rows)) {
      if (row.latitude === undefined || row.longitude === undefined) continue;
      const key = `${Math.round(n(row.latitude) * 10)},${Math.round(n(row.longitude) * 10)}`;
      groups[key] = groups[key] ?? { latitude: n(row.latitude), longitude: n(row.longitude), visits: 0, total: 0 };
      groups[key].visits++; groups[key].total += cents(row);
    }
    return Object.values(groups).sort((a, b) => b.total - a.total);
  },
  normalizeMeal(meal: unknown) { return normalizeMeal(meal as never) as unknown as Recipe; },
  parseReceipt(text: string) {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const match = line.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur)?\s*$/i);
      if (!match || match.index === undefined) return null;
      const name = line.slice(0, match.index).trim().replace(/^[-*•]\s*/, "");
      if (!name) return null;
      return { name, cents: Math.round(Number(match[1].replace(",", ".")) * 100) };
    }).filter(Boolean) as { name: string; cents: number }[];
  },
  chatCommand(text: string) {
    const parts = text.trim().split(/\s+/);
    if (parts[0]?.toLowerCase() === "/undo") return { command: "undo", kind: "expense", cents: 0, category: "", merchant: "" };
    return { command: parts[0] ?? "", kind: parts[0]?.toLowerCase() === "/income" ? "income" : "expense",
      cents: parseEuro(parts[1] ?? "") ?? 0, category: parts[2] ?? "", merchant: parts[3] ?? parts[2] ?? "" };
  },
  priceStats(prices: unknown, name: string, store: string) { return stats(arr(prices), name, store); },
  forecast(prices: unknown, name: string, store: string, today = todayIso()) { return forecast(arr(prices), name, store, today); },
  optimize(prices: unknown, items: unknown, stores: string[], today = todayIso()) {
    const priceRows = arr(prices);
    return arr(items).map((item) => {
      let best: { store: string; cents: number } | null = null, worst = 0;
      for (const store of stores) {
        const current = stats(priceRows, s(item.name), store).current;
        if (!current) continue;
        worst = Math.max(worst, current);
        if (!best || current < best.cents) best = { store, cents: current };
      }
      if (!best) return null;
      const f = forecast(priceRows, s(item.name), best.store, today);
      return { name: s(item.name), store: best.store, cents: best.cents, savings: worst - best.cents,
        weekday: f.weekday, nextDate: f.nextDate, buyNow: f.buyNow };
    }).filter(Boolean);
  },
  scheduled(rows: unknown, today = todayIso()) {
    const [ty, tm] = today.split("-").map(Number);
    const dayNow = new Date(`${today}T12:00:00Z`).getUTCDate();
    return arr(rows).filter((r) => n(r.active ?? 1) === 1).map((r) => {
      const target = Math.min(28, Math.max(1, n(r.dayOfMonth || 1)));
      let year = ty, month = tm;
      if (dayNow > target) { month++; if (month > 12) { month = 1; year++; } }
      return { name: s(r.name), amountCents: n(r.amountCents), category: s(r.category),
        nextDate: `${year}-${String(month).padStart(2, "0")}-${String(target).padStart(2, "0")}` };
    }).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  },
  warrantyStatus(rows: unknown, today = todayIso()) {
    return arr(rows).map((r) => {
      const until = s(r.warrantyUntil);
      const daysLeft = until ? dateToZ(until) - dateToZ(today) : -1;
      return { name: s(r.merchant), amountCents: n(r.amountCents), warrantyUntil: until, daysLeft, expired: daysLeft < 0 };
    }).sort((a, b) => a.daysLeft - b.daysLeft);
  },
  dueSoon(rows: unknown, days = 7) {
    const start = dateToZ(todayIso());
    return arr(rows).filter((r) => { const z = dateToZ(s(r.nextDate)); return z >= start && z <= start + days; });
  },
  debtSummary(rows: unknown) {
    const total = arr(rows).reduce((a, r) => a + n(r.totalCents), 0), paid = arr(rows).reduce((a, r) => a + n(r.paidCents), 0);
    return { total, paid, remaining: total - paid };
  },
  assistant(question: string, rows: unknown, budgets: unknown) {
    const q = question.toLowerCase(), totals = txTotals(arr(rows), ""), cats = categoryTotals(arr(rows), "");
    if (q.includes("biggest") || q.includes("largest")) return cats[0] ? `Your biggest category is ${cats[0].category} at ${formatEuro(cats[0].cents)}.` : "No spending recorded yet.";
    if (q.includes("income")) return `You recorded ${formatEuro(totals.income)} of income.`;
    if (q.includes("budget")) {
      const status = budgetStatus(arr(budgets), cats);
      const found = status.find((b) => q.includes(b.category.toLowerCase()));
      return found ? `Budget for ${found.category}: ${formatEuro(found.spent)} spent of ${formatEuro(found.limit)}, ${formatEuro(found.remaining)} left (${found.percent}%).` : `You have ${status.length} budgets.`;
    }
    if (q.includes("average")) return `On average you spend ${formatEuro(Math.round(totals.expense / 30))} per day.`;
    return `You spent ${formatEuro(totals.expense)} against ${formatEuro(totals.income)} of income; balance is ${formatEuro(totals.balance)}.`;
  },
  combinedSummary(own: unknown, partner: unknown) {
    const a = txTotals(arr(own), ""), b = txTotals(arr(partner), "");
    return { ownExpense: a.expense, partnerExpense: b.expense, totalExpense: a.expense + b.expense,
      ownIncome: a.income, partnerIncome: b.income, totalIncome: a.income + b.income };
  },
  evaluate(text: string) {
    try {
      const clean = text.replace(/,/g, ".");
      if (!/^[\d+\-*/(). ]+$/.test(clean)) return null;
      const value = Function(`"use strict";return (${clean})`)() as number;
      return Number.isFinite(value) ? Math.round(value * 100) : null;
    } catch { return null; }
  },
  ledgerBalance(entries: unknown, account: string) {
    return arr(entries).filter((e) => s(e.accountId) === account).reduce((sum, e) => sum + (s(e.side) === "credit" ? n(e.cents) : -n(e.cents)), 0);
  },
  ledgerCheck(entries: unknown) {
    const totals: Record<string, { d: number; c: number }> = {};
    for (const e of arr(entries)) { const t = totals[s(e.txId)] ?? { d: 0, c: 0 }; if (s(e.side) === "credit") t.c += n(e.cents); else t.d += n(e.cents); totals[s(e.txId)] = t; }
    const problems = Object.entries(totals).filter(([, t]) => t.d !== t.c).map(([tx, t]) => `${tx}: ${t.d} vs ${t.c}`);
    return { balanced: problems.length === 0, problems };
  },
  goalStatus(goals: unknown) {
    return arr(goals).map((g) => {
      const target = n(g.targetCents), saved = n(g.savedCents);
      return { name: s(g.name ?? g.title), target, saved, remaining: Math.max(0, target - saved),
        percent: target ? Math.min(100, Math.round((saved * 100) / target)) : 0, daysLeft: 0 };
    });
  },
  rolloverStatus(budgets: unknown, spending: unknown) {
    const spent: Record<string, number> = {};
    for (const row of arr(spending)) spent[s(row.category)] = (spent[s(row.category)] ?? 0) + n(row.cents);
    return arr(budgets).map((b) => {
      const limit = n(b.limitCents), rollover = n(b.rolloverCents), used = spent[s(b.category)] ?? 0, available = limit + rollover;
      return { category: s(b.category), limit, rollover, spent: used, available, remaining: available - used };
    });
  },
  checklistStatus(goals: unknown, items: unknown) {
    return arr(goals).map((g) => {
      const own = arr(items).filter((i) => n(i.goalId) === n(g.id));
      const done = own.filter((i) => n(i.completed) === 1).length;
      return { id: n(g.id), name: s(g.name ?? g.title), done, total: own.length,
        plan: own.reduce((a, i) => a + n(i.amountCents), 0),
        paid: own.filter((i) => n(i.completed) === 1).reduce((a, i) => a + n(i.amountCents), 0) };
    });
  },
  invoiceTotal(items: unknown, taxPercent = 0) {
    const subtotal = arr(items).reduce((a, i) => a + n(i.qty || 1) * n(i.cents), 0);
    return Math.round(subtotal * (1 + taxPercent / 100));
  },
  valuationChange(rows: unknown, account: string) {
    const values = arr(rows).filter((r) => s(r.accountId) === account).sort((a, b) => s(a.date).localeCompare(s(b.date)));
    return values.length ? n(values[values.length - 1].valueCents) - n(values[0].valueCents) : 0;
  },
  compareMonths(rows: unknown, current: string, previous: string) {
    const totalFor = (prefix: string) => arr(rows).filter((r) => s(r.date).startsWith(prefix) && r.kind !== "income").reduce((a, r) => a + cents(r), 0);
    const map: Record<string, { c: number; p: number }> = {};
    for (const r of arr(rows)) {
      const key = s(r.category || "uncategorised");
      const slot = map[key] ?? { c: 0, p: 0 };
      if (s(r.date).startsWith(current)) slot.c += cents(r);
      if (s(r.date).startsWith(previous)) slot.p += cents(r);
      map[key] = slot;
    }
    const categories = Object.entries(map).map(([category, v]) => ({ category, current: v.c, previous: v.p,
      changePercent: v.p ? ((v.c - v.p) / v.p) * 100 : 0 })).sort((a, b) => b.current - a.current);
    return { current: totalFor(current), previous: totalFor(previous), categories };
  },
  spendingSummary(rows: unknown, locale = "en") {
    const totals = txTotals(arr(rows), ""), cats = categoryTotals(arr(rows), "");
    const label = locale === "de" ? "Ausgaben" : "spending";
    return cats[0] ? `Total ${label}: ${formatEuro(totals.expense)} · biggest category ${cats[0].category} (${formatEuro(cats[0].cents)}) · ${cats.length} categories used` : `No ${label} recorded yet.`;
  },
  paycheckPlan(takeHome: number, rules: unknown) {
    let used = 0;
    const out = arr(rules).map((r) => {
      const cents = n(r.cents) > 0 ? n(r.cents) : Math.round((takeHome * n(r.percent)) / 100);
      const value = Math.min(cents, Math.max(0, takeHome - used));
      used += value;
      return { label: s(r.label), cents: value, kind: s(r.kind) };
    });
    out.push({ label: "Guilt-free", cents: takeHome - used, kind: "leftover" });
    return out;
  },
  paycheckDates(start: string, frequency: string, count = 6) {
    const step = frequency === "weekly" ? 7 : frequency === "biweekly" ? 14 : frequency === "semimonthly" ? 15 : 30;
    const base = dateToZ(start);
    return Array.from({ length: Math.max(1, count) }, (_, i) => zToDate(base + i * step));
  },
  paycheckProration(amount: number, frequency: string) {
    const divisor = frequency === "weekly" ? 52 / 12 : frequency === "biweekly" ? 26 / 12 : frequency === "semimonthly" ? 24 / 12 : 1;
    return Math.round(amount / divisor);
  },
  scheduleRecurring(rows: unknown, count = 6) {
    const today = todayIso();
    return arr(rows).map((r) => {
      const step = s(r.frequency) === "weekly" ? 7 : s(r.frequency) === "biweekly" ? 14 : s(r.frequency) === "semimonthly" ? 15 : 30;
      const limit = n(r.count || count);
      let cursor = dateToZ(s(r.startDate || today)), generated = 0;
      const zNow = dateToZ(today);
      while (cursor < zNow && generated < limit) { cursor += step; generated++; }
      const dates: string[] = [];
      while (generated < limit && dates.length < count) { dates.push(zToDate(cursor)); cursor += step; generated++; }
      return { name: s(r.name), dates };
    });
  },
  billConfirm(billCents: number, paidCents: number) {
    const difference = paidCents - billCents;
    return { difference, overage: Math.max(0, difference), shortfall: Math.max(0, -difference),
      recoveryPlan: difference < 0 ? "Create a recovery plan for the shortfall." : "No recovery needed." };
  },
  creditPayoff(balanceCents: number, monthlyCents: number, aprPercent = 18) {
    if (monthlyCents <= 0) return { months: 0, interest: 0 };
    let balance = balanceCents, months = 0, interest = 0;
    while (balance > 0 && months < 600) { const i = balance * (aprPercent / 100 / 12); interest += Math.round(i); balance += i - monthlyCents; months++; }
    return { months, interest };
  },
  paycheckHistory(paychecks: unknown, allocations: unknown) {
    return arr(paychecks).map((p) => {
      const planned = arr(allocations).filter((a) => n(a.paycheckId) === n(p.id)).reduce((a, x) => a + n(x.cents), 0);
      return { date: s(p.date), takeHome: n(p.takeHomeCents), planned, guiltFree: n(p.takeHomeCents) - planned };
    });
  },
  goldProfit(grams: number, buyCents: number, currentCents: number) {
    const cost = Math.round(grams * buyCents), value = Math.round(grams * currentCents);
    return { cost, value, profit: value - cost };
  },
  receivableStatus(rows: unknown, today = todayIso()) {
    return arr(rows).map((r) => ({ name: s(r.name), remaining: n(r.totalCents) - n(r.paidCents),
      dueDate: s(r.dueDate), overdue: dateToZ(s(r.dueDate)) < dateToZ(today) }));
  },
  subscriptionNext(rows: unknown, today = todayIso()) {
    return arr(rows).map((r) => {
      const start = s(r.startDate || today);
      const [y, m, d] = start.split("-").map(Number);
      const next = s(r.interval) === "weekly" ? zToDate(dateToZ(start) + 7) :
        `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-${String(Math.min(28, d)).padStart(2, "0")}`;
      return { name: s(r.name), amountCents: n(r.amountCents), interval: s(r.interval), nextDate: next };
    });
  },
  projectFunding(items: unknown, available: number) {
    let remaining = available;
    const list = arr(items).map((item) => {
      const cents = n(item.cents), funded = remaining >= cents;
      if (funded) remaining -= cents;
      return { name: s(item.name), cents, funded };
    });
    return { items: list, unused: remaining };
  },
  splitBill(centsValue: number, count: number, mode: string, shares: number[]) {
    const weights = mode === "equal" || shares.length !== count ? Array.from({ length: count }, () => 1) :
      shares.map((v) => (mode === "percent" ? v / 100 : v));
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const out = weights.map((w) => Math.floor((centsValue * w) / total));
    let rest = centsValue - out.reduce((a, b) => a + b, 0);
    for (let i = 0; i < out.length && rest > 0; i++, rest--) out[i]++;
    return out;
  },
};
