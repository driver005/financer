export function todayStr(tz = "Asia/Jakarta"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function currentMonth(tz?: string): string {
  return todayStr(tz).slice(0, 7);
}

function parts(s: string): number[] {
  return s.split("-").map((x) => Number(x));
}

export function monthRange(m: string): { start: string; end: string } {
  const [y = 2000, mo = 1] = parts(m);
  return { start: `${m}-01`, end: new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10) };
}

export function shiftMonth(m: string, delta: number): string {
  const [y = 2000, mo = 1] = parts(m);
  return new Date(Date.UTC(y, mo - 1 + delta, 1)).toISOString().slice(0, 7);
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export function addMonthsKeepDay(date: string, n: number, day?: number): string {
  const [y = 2000, m = 1, d = 1] = parts(date);
  const t = m - 1 + n;
  const y2 = y + Math.floor(t / 12);
  const m2 = ((t % 12) + 12) % 12;
  const dim = new Date(Date.UTC(y2, m2 + 1, 0)).getUTCDate();
  const dd = Math.min(day ?? d, dim);
  return `${y2}-${String(m2 + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function monthLabel(m: string, locale = "id-ID"): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(m + "-01T00:00:00Z"));
}

export function shortMonth(m: string, locale = "id-ID"): string {
  return new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
    new Date(m + "-01T00:00:00Z"),
  );
}

export function dateLabel(d: string | null | undefined, locale = "id-ID"): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(d.slice(0, 10) + "T00:00:00Z"));
}
