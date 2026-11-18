/** Pure, client-safe fee & tax helpers (unit-tested). */
export type FeePreset = { label: string; amount: number };
export const FEE_CATEGORY = "Biaya Admin";

/** "BI-FAST=2500; Online=6500" → [{label, amount}] (also accepts arrays). */
export function parsePresets(v: unknown): FeePreset[] {
  if (Array.isArray(v))
    return v
      .filter((p) => p && Number(p.amount) > 0)
      .map((p) => ({ label: String(p.label ?? "").slice(0, 40), amount: Number(p.amount) }));
  if (typeof v !== "string") return [];
  return v
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [l, a] = s.includes("=") ? s.split("=") : ["", s];
      return {
        label: (l ?? "").trim().slice(0, 40) || "Biaya",
        amount: Number(String(a ?? "").replace(/[^\d]/g, "")),
      };
    })
    .filter((p) => p.amount > 0)
    .slice(0, 20);
}

export const formatPresets = (p: unknown) =>
  parsePresets(p)
    .map((x) => `${x.label}=${x.amount}`)
    .join("; ");

type AccLike = { id: string; transfer_fees?: unknown; topup_fees?: unknown } | undefined;

/** Presets offered for a transfer: sender's transfer fees + receiver's top-up admin fees. */
export function feeOptions(from: AccLike, to: AccLike): FeePreset[] {
  return [...parsePresets(from?.transfer_fees), ...parsePresets(to?.topup_fees)];
}

/** Day the monthly fee is charged in a given month, clamped to month length. */
export function feeDate(month: string, day: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Math.max(1, day), last)).padStart(2, "0")}`;
}

export const monthlyFeeMarker = (accountId: string, month: string) =>
  `[auto:monthly_fee:${accountId}:${month}]`;

/** Accounts whose monthly fee for `today`'s month is due and not recorded yet. */
export function dueMonthlyFees<
  T extends { id: string; monthly_fee?: unknown; monthly_fee_day?: unknown; archived?: boolean },
>(accounts: T[], today: string, recorded: Set<string>) {
  const month = today.slice(0, 7);
  return accounts
    .filter((a) => !a.archived && Number(a.monthly_fee) > 0)
    .map((a) => ({
      account: a,
      date: feeDate(month, Number(a.monthly_fee_day) || 1),
      marker: monthlyFeeMarker(a.id, month),
    }))
    .filter((x) => x.date <= today && !recorded.has(x.marker));
}

/** Subscription price including optional tax percent. */
export function withTax(amount: number, taxPercent?: number | null): number {
  const t = Number(taxPercent) || 0;
  return Math.round(amount * (1 + t / 100) * 100) / 100;
}
