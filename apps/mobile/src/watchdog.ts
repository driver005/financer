/**
 * Pure logic for the Subscriptions and Alerts screens: week grouping of the charge calendar,
 * badges for price hikes / duplicates, and the wording of alerts. The server sends keys and
 * numbers (`kind`, `cadence`, cents); the words are chosen here.
 */
import type { Alert, PriceHike, Subscriptions, UpcomingCharge } from "./api/client";
import { formatCents, formatDate } from "./format";

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** The Monday of the week that contains `iso` (weeks run Monday to Sunday). */
export function weekStart(iso: string): string {
  const ms = toUtc(iso);
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return toIso(ms - sinceMonday * DAY_MS);
}

export type WeekGroup = {
  /** Monday of the week, or `"overdue"` for charges whose date has passed. */
  key: string;
  label: string;
  items: UpcomingCharge[];
  totalCents: number;
};

/** `2026-10-05` -> `05.10.` */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

/** Calendar entries grouped by week ("Overdue", "This week", "Next week", "05.10. - 11.10."). */
export function groupByWeek(upcoming: UpcomingCharge[], asOf: string): WeekGroup[] {
  const thisWeek = weekStart(asOf);
  const nextWeek = toIso(toUtc(thisWeek) + 7 * DAY_MS);
  const groups = new Map<string, WeekGroup>();
  const sorted = [...upcoming].sort((a, b) => a.date.localeCompare(b.date) || a.counterparty.localeCompare(b.counterparty));
  for (const item of sorted) {
    const key = item.overdue ? "overdue" : weekStart(item.date);
    let group = groups.get(key);
    if (!group) {
      const end = toIso(toUtc(key === "overdue" ? asOf : key) + 6 * DAY_MS);
      const label =
        key === "overdue"
          ? "Overdue"
          : key === thisWeek
            ? "This week"
            : key === nextWeek
              ? "Next week"
              : `${shortDate(key)} - ${shortDate(end)}`;
      group = { key, label, items: [], totalCents: 0 };
      groups.set(key, group);
    }
    group.items.push(item);
    group.totalCents += item.amount_cents;
  }
  // overdue first, then weeks in date order
  return [...groups.values()].sort((a, b) => (a.key === "overdue" ? -1 : b.key === "overdue" ? 1 : a.key.localeCompare(b.key)));
}

export const CADENCE_LABEL: Record<string, string> = {
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly",
  yearly: "yearly",
};

export function cadenceLabel(cadence: string): string {
  return CADENCE_LABEL[cadence] ?? cadence;
}

/** `2002` basis points -> `+20,0 %` */
export function percentText(bp: number): string {
  const tenths = Math.round(Math.abs(bp) / 10);
  const text = `${Math.floor(tenths / 10)},${tenths % 10}`;
  return `${bp < 0 ? "-" : "+"}${text} %`;
}

export function hikeText(h: PriceHike): string {
  return `${h.counterparty} went from ${formatCents(h.old_amount_cents)} to ${formatCents(h.new_amount_cents)} (${percentText(h.percent_bp)}, +${formatCents(h.delta_cents)} per ${periodWord(h.cadence)}) since ${formatDate(h.since)}.`;
}

function periodWord(cadence: string): string {
  return { weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year" }[cadence] ?? "charge";
}

export type RowBadge = { id: "hike" | "duplicate" | "late" | "unsure"; text: string; tone: "bad" | "warn" | "muted" };

/** Badges shown on a calendar row, looked up by merchant name in the report. */
export function badgesFor(item: UpcomingCharge, report: Pick<Subscriptions, "price_hikes" | "duplicates">): RowBadge[] {
  const out: RowBadge[] = [];
  const hike = report.price_hikes.find((h) => h.counterparty === item.counterparty);
  if (hike) out.push({ id: "hike", text: `Price up ${percentText(hike.percent_bp)}`, tone: "bad" });
  if (report.duplicates.some((d) => d.first.counterparty === item.counterparty || d.second.counterparty === item.counterparty)) {
    out.push({ id: "duplicate", text: "Possible duplicate", tone: "warn" });
  }
  if (item.overdue) out.push({ id: "late", text: "Not booked yet", tone: "warn" });
  if (item.confidence < 50) out.push({ id: "unsure", text: `${item.confidence} % sure`, tone: "muted" });
  return out;
}

export function duplicateText(d: Subscriptions["duplicates"][number]): string {
  const a = d.first;
  const b = d.second;
  const same = d.reason === "same_merchant";
  return `${same ? `${a.counterparty} is billed twice` : `${a.counterparty} and ${b.counterparty} look like the same service`}, both ${cadenceLabel(a.cadence)} at ${formatCents(a.amount_cents)} and ${formatCents(b.amount_cents)}. Cancel one if you only need it once.`;
}

export function staleText(s: Subscriptions["stale"][number]): string {
  const sub = s.subscription;
  return `Last ${formatCents(sub.amount_cents)} on ${formatDate(sub.last_date)}; ${s.periods_missed} ${cadenceLabel(sub.cadence)} charges did not come since. Cancelled or paused? If you did not cancel it, check your contract.`;
}

export const ALERT_KIND_LABEL: Record<string, string> = {
  duplicate_charge: "Possible duplicate charge",
  unusual_amount: "Unusual amount",
  new_merchant: "New merchant",
  large_for_category: "Large for its category",
};

export function alertKindLabel(kind: string): string {
  return ALERT_KIND_LABEL[kind] ?? kind;
}

export const SEVERITY_LABEL: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

/** Higher first. */
export function severityRank(severity: string): number {
  return { high: 3, medium: 2, low: 1 }[severity] ?? 0;
}

/** Explanation of an alert in the app's wording; unknown kinds fall back to the server's English `reason`. */
export function alertText(a: Alert): string {
  const amount = formatCents(a.amount_cents);
  const reference = a.reference_cents != null ? formatCents(a.reference_cents) : null;
  switch (a.kind) {
    case "duplicate_charge":
      return `${a.counterparty} charged ${amount} again within a few days of an identical charge. If it was one purchase, ask them for a refund.`;
    case "unusual_amount":
      return reference
        ? `${amount} is far above the usual ${reference} at ${a.counterparty} (based on ${a.history_count} earlier charges).`
        : a.reason;
    case "new_merchant":
      return `First payment to ${a.counterparty}, and it is ${amount}. Fine if you know it; otherwise check the charge.`;
    case "large_for_category":
      return reference
        ? `${amount} at ${a.counterparty} is large for this category, where the usual is about ${reference}.`
        : a.reason;
    default:
      return a.reason;
  }
}

/** Alerts in the order they should be read: high severity first, then newest. */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      Number(a.dismissed) - Number(b.dismissed) ||
      severityRank(b.severity) - severityRank(a.severity) ||
      b.booking_date.localeCompare(a.booking_date) ||
      b.transaction_id - a.transaction_id,
  );
}

/** One line for the Today card: the next charge within `withinDays` of `asOf`. */
export function nextChargeText(upcoming: UpcomingCharge[], asOf: string, withinDays: number): string | null {
  const limit = toIso(toUtc(asOf) + withinDays * DAY_MS);
  const next = [...upcoming].sort((a, b) => a.date.localeCompare(b.date)).find((u) => u.date <= limit);
  return next ? `Next: ${next.counterparty} ${formatCents(next.amount_cents)} on ${shortDate(next.date)}` : null;
}
