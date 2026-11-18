import { getDb } from "./database";
import { setSetting, getSetting } from "./database";

const SAMPLE: [string, string, number, string][] = [
  ["2026-11-01", "Salary", 245000, "Salary"],
  ["2026-11-02", "REWE", 3420, "Groceries"],
  ["2026-11-03", "Lidl", 1890, "Groceries"],
  ["2026-11-05", "Rent", 90000, "Rent"],
  ["2026-11-07", "Bus ticket", 290, "Transport"],
  ["2026-11-10", "Coffee", 350, "Leisure"],
];

/** Disposable local demo data — the offline equivalent of the apps' demo accounts. */
export async function loadDemoData(): Promise<boolean> {
  if (await getSetting("demoLoaded")) return false;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const [date, merchant, amountCents, category] of SAMPLE) {
      await db.runAsync(
        "INSERT INTO transactions (date, merchant, amountCents, category, storeId, source, externalId, kind) VALUES (?, ?, ?, ?, NULL, 'demo', ?, ?)",
        date, merchant, amountCents, category, `demo-${date}-${merchant}`, category === "Salary" ? "income" : "expense",
      );
    }
  });
  await setSetting("demoLoaded", "1");
  return true;
}
