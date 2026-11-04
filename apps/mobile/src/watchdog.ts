/**
 * The Subscriptions and Alerts screens: week grouping of the charge calendar, badges for price
 * hikes and duplicates, and the wording of alerts. The server sends keys and numbers; the words are
 * chosen in Rust (crates/logic, watchdog.rs). Items travel as the server's own JSON.
 */
import type { Alert, PriceHike, Subscriptions, UpcomingCharge } from "./api/client";
import { logic } from "../../../packages/wire/src/logic";

/** The Monday of the week that contains `iso` (weeks run Monday to Sunday). */
export const weekStart = (iso: string): string => logic("watchdog.week_start", { iso });

export type WeekGroup = {
  /** Monday of the week, or `"overdue"` for charges whose date has passed. */
  key: string;
  label: string;
  items: UpcomingCharge[];
  totalCents: number;
};

/** `2026-10-05` -> `05.10.` */
export const shortDate = (iso: string): string => logic("watchdog.short_date", { iso });

/** Calendar entries grouped by week ("Overdue", "This week", "Next week", "05.10. - 11.10."). */
export const groupByWeek = (upcoming: UpcomingCharge[], asOf: string): WeekGroup[] => logic("watchdog.group_by_week", { upcoming, as_of: asOf });

export const CADENCE_LABEL: Record<string, string> = {
  weekly: "weekly",
  monthly: "monthly",
  quarterly: "quarterly",
  yearly: "yearly",
};

export const cadenceLabel = (cadence: string): string => logic("watchdog.cadence_label", { cadence });

/** `2002` basis points -> `+20,0 %` */
export const percentText = (bp: number): string => logic("watchdog.percent_text", { bp });

export const hikeText = (h: PriceHike): string => logic("watchdog.hike_text", { h });

export type RowBadge = { id: "hike" | "duplicate" | "late" | "unsure"; text: string; tone: "bad" | "warn" | "muted" };

/** Badges shown on a calendar row, looked up by merchant name in the report. */
export const badgesFor = (item: UpcomingCharge, report: Pick<Subscriptions, "price_hikes" | "duplicates">): RowBadge[] =>
  logic("watchdog.badges_for", { item, price_hikes: report.price_hikes, duplicates: report.duplicates });

export const duplicateText = (d: Subscriptions["duplicates"][number]): string => logic("watchdog.duplicate_text", { d });

export const staleText = (s: Subscriptions["stale"][number]): string => logic("watchdog.stale_text", { s });

export const ALERT_KIND_LABEL: Record<string, string> = {
  duplicate_charge: "Possible duplicate charge",
  unusual_amount: "Unusual amount",
  new_merchant: "New merchant",
  large_for_category: "Large for its category",
};

export const alertKindLabel = (kind: string): string => logic("watchdog.alert_kind_label", { kind });

export const SEVERITY_LABEL: Record<string, string> = { high: "High", medium: "Medium", low: "Low" };

/** Higher first. */
export const severityRank = (severity: string): number => logic("watchdog.severity_rank", { severity });

/** Explanation of an alert in the app's wording; unknown kinds fall back to the server's English `reason`. */
export const alertText = (a: Alert): string => logic("watchdog.alert_text", { a });

/** Alerts in the order they should be read: high severity first, then newest. */
export const sortAlerts = (alerts: Alert[]): Alert[] => logic("watchdog.sort_alerts", { alerts });

/** One line for the Today card: the next charge within `withinDays` of `asOf`. */
export const nextChargeText = (upcoming: UpcomingCharge[], asOf: string, withinDays: number): string | null =>
  logic("watchdog.next_charge_text", { upcoming, as_of: asOf, within_days: withinDays });
