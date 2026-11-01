// Number and date texts. The app is English with German number formatting, like the finance app.

/** `1.299,00 €`. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const euros = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${euros},${(abs % 100).toString().padStart(2, "0")} €`;
}

export function formatPercent(pct: number): string {
  return `${Math.round(pct)} %`;
}
