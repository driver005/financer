// CI only: fills the on-phone backend with a believable demo month so the screenshot job (see
// .github/workflows/native.yml, "screenshots") has something to show on every screen. Dates are
// relative to today, so the current budget period always has bookings. Nothing here ships in a
// normal build: the file is only loaded by scripts/smoke-entry.js.
const HEADER =
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"';
const ACCOUNT = "DE89370400440532013000";

const pad = (n) => String(n).padStart(2, "0");
const day = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}`;
const money = (cents) => (cents / 100).toFixed(2).replace(".", ",");

function row(date, text, purpose, who, cents) {
  return `"${ACCOUNT}";"${day(date)}";"${day(date)}";"${text}";"${purpose}";"${who}";"";"";"${money(cents)}";"EUR";"Umsatz gebucht"`;
}

/** About two months of bookings: salary, rent, subscriptions and a mix of supermarkets. */
function demoCsv(now = new Date()) {
  const rows = [];
  const ago = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
  const shops = [
    ["LIDL SAGT DANKE//Berlin/DE", "Lidl Dienstleistung GmbH", [-1294, -2231, -1580, -3012, -1876]],
    ["REWE Markt GmbH", "REWE Markt GmbH", [-4674, -2390, -3815, -5120]],
    ["ALDI SAGT DANKE", "ALDI SUED", [-1840, -2655, -1320]],
    ["KAUFLAND DANKE", "Kaufland Stiftung", [-2917, -4403]],
    ["dm-drogerie markt", "dm-drogerie markt", [-1790, -2480]],
    ["EDEKA Berlin", "EDEKA Minden", [-1215, -2260]],
  ];
  let step = 2;
  for (const [purpose, who, amounts] of shops) {
    for (const cents of amounts) {
      rows.push(row(ago(step), "KARTENZAHLUNG", purpose, who, cents));
      step = (step + 3) % 58 + 1;
    }
  }
  for (const m of [0, 1, 2]) {
    const first = new Date(now.getFullYear(), now.getMonth() - m, 1);
    if (first <= now) {
      rows.push(row(first, "GEHALT", "Gehalt", "Arbeitgeber AG", 265000));
      rows.push(row(new Date(first.getFullYear(), first.getMonth(), 2), "DAUERAUFTRAG", "Miete", "Hausverwaltung Schmidt", -87000));
      rows.push(row(new Date(first.getFullYear(), first.getMonth(), 5), "LASTSCHRIFT", "Netflix", "Netflix International", -1299));
      rows.push(row(new Date(first.getFullYear(), first.getMonth(), 7), "LASTSCHRIFT", "Vodafone Rechnung", "Vodafone GmbH", -3999));
    }
  }
  return `${HEADER}\n${rows.join("\n")}\n`;
}

const REWE_RECEIPT = [
  "REWE Markt GmbH",
  "BIO VOLLMILCH 3,5%  1,19 B",
  "SPAGHETTI 500G  0,89 A",
  "BANANEN  1,49 B",
  "EIER BODENHALTUNG 10ER  2,29 B",
  "JOGHURT NATUR  0,99 B",
  "SUMME EUR  6,85",
  "",
].join("\n");

const LIDL_RECEIPT = ["LIDL", "Bananen  1,29 B", "Milch 1,5%  1,09 B", "Brot  2,49 B", "Butter  2,19 B", "SUMME EUR  7,06", ""].join("\n");

/** Imports the demo data through an `EmbeddedTransport`-like object (`send({method, path, ...})`). */
async function seedDemo(t) {
  const csv = await t.send({ method: "POST", path: "/v1/transactions/import", headers: { "Content-Type": "text/csv" }, body: demoCsv() });
  const receipts = [];
  for (const text of [REWE_RECEIPT, LIDL_RECEIPT]) {
    receipts.push((await t.send({ method: "POST", path: "/v1/receipts", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) })).status);
  }
  return `csv=${csv.status} receipts=${receipts.join(",")}`;
}

module.exports = { demoCsv, seedDemo };
