/** `-2347` -> `-23,47 €` (German notation, integer cents in, no floats). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${euros},${(abs % 100).toString().padStart(2, "0")} €`;
}

/** `2026-03-02` -> `02.03.2026` */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Parse German or plain euro input (`40`, `40,50`, `1.234,5`) into cents; `null` if invalid. */
export function parseEuroInput(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) return null;
  const [int, frac = ""] = s.replace(/\./g, "").split(",");
  return Number(int) * 100 + Number(frac.padEnd(2, "0"));
}
