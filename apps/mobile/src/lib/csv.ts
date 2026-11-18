import type { Transaction } from "./types";
import { parseEuro } from "./money";

/** Parse a simple, local CSV export: date;merchant;amount[,category]. Accepts , ; or tab. */
export function parseTransactionCsv(text: string): { rows: Transaction[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const delimiter = lines[0]?.includes(";") ? ";" : lines[0]?.includes("\t") ? "\t" : ",";
  const rows: Transaction[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, index) => {
    const parts = line.split(delimiter).map((part) => part.trim().replace(/^"|"$/g, ""));
    const date = parts[0] ?? "";
    const merchant = parts[1] ?? "";
    const cents = parseEuro(parts[2] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !merchant || cents === null) {
      errors.push(`Line ${index + 2}: expected date (YYYY-MM-DD), merchant, amount`);
      return;
    }
    rows.push({
      id: 0,
      date,
      merchant,
      amountCents: Math.abs(cents),
      category: parts[3] || "uncategorised",
      storeId: null,
      source: "csv",
      externalId: null,
    });
  });
  return { rows, errors };
}

export function exportJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
