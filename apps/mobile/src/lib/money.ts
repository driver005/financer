export function parseEuro(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function formatEuro(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function scaleAmount(text: string, servings: number, base: number): string {
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
  if (!match || base <= 0) return text;
  const value = (Number(match[1].replace(",", ".")) * servings) / base;
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
  return `${rounded}${match[2] ? ` ${match[2]}` : ""}`;
}
