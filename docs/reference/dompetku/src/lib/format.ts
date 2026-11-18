import { isPrivate, MASK } from "./privacy";

export type FormatOpts = {
  /** Show the real amount even in privacy mode (form inputs/previews while editing). */
  reveal?: boolean;
};

function currencyPrefix(cur: string): string {
  try {
    const part = new Intl.NumberFormat(cur === "USD" ? "en-US" : "id-ID", {
      style: "currency",
      currency: cur,
    })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? cur;
  } catch {
    return cur;
  }
}

export function money(
  v: number | string | null | undefined,
  cur: string = "IDR",
  opts?: FormatOpts,
): string {
  // Fixed-length mask so the string length doesn't leak the magnitude.
  if (isPrivate() && !opts?.reveal) return `${currencyPrefix(cur)} ${MASK}`;
  const n = Number(v ?? 0) || 0;
  return new Intl.NumberFormat(cur === "USD" ? "en-US" : "id-ID", {
    style: "currency",
    currency: cur,
    maximumFractionDigits: cur === "USD" ? 2 : 0,
  }).format(n);
}

export function compact(v: number, opts?: FormatOpts): string {
  if (isPrivate() && !opts?.reveal) return "•••";
  return new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(
    v,
  );
}
export const KIND_LABEL: Record<string, string> = {
  income: "Pemasukan",
  expense: "Pengeluaran",
  transfer: "Transfer",
};
