/**
 * PostgREST (Supabase) caps every response at `max-rows` (1000 by default) no matter what `.limit()`
 * asks for. `fetchAll` pages through a query with `.range()` until a short page comes back or the
 * hard cap is reached. Pages are fetched sequentially and only while the previous page was full.
 *
 * The builder MUST apply a stable, total order (add an `.order("id")` tie-breaker) so rows never
 * shift between pages. Pure and client-safe: it only needs a thenable returning `{ data, error }`.
 */
export const PAGE_SIZE = 1000;
export const DEFAULT_HARD_CAP = 100_000;

export type PageResult<E> = { data: unknown; error: E | null };
export type FetchAllOptions = { pageSize?: number; hardCap?: number };

export async function fetchAll<T = any, E = { message: string }>( // eslint-disable-line @typescript-eslint/no-explicit-any
  build: (from: number, to: number) => PromiseLike<PageResult<E>>,
  options: FetchAllOptions = {},
): Promise<{ data: T[] | null; error: E | null }> {
  const pageSize = Math.max(1, Math.floor(options.pageSize ?? PAGE_SIZE));
  const hardCap = Math.max(0, Math.floor(options.hardCap ?? DEFAULT_HARD_CAP));
  const rows: T[] = [];
  for (let from = 0; from < hardCap; from += pageSize) {
    const to = Math.min(from + pageSize, hardCap) - 1;
    const res = await build(from, to);
    if (res.error) return { data: null, error: res.error };
    const batch = (Array.isArray(res.data) ? res.data : []) as T[];
    for (const row of batch) rows.push(row);
    if (batch.length < to - from + 1) break;
  }
  return { data: rows, error: null };
}

/* ---------- Client-side pagination of already-loaded lists (pure, client-safe) ---------- */

function toInt(n: number, fallback: number): number {
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

/**
 * Snaps `offset` onto a page boundary inside `[0, lastPageStart]`. Used when a list shrinks
 * (e.g. deleting the only row on the last page) so the view falls back to the new last page.
 */
export function clampOffset(offset: number, total: number, pageSize: number): number {
  const size = Math.max(1, toInt(pageSize, 1));
  const count = Math.max(0, toInt(total, 0));
  if (count === 0) return 0;
  const lastStart = Math.floor((count - 1) / size) * size;
  const aligned = Math.floor(Math.max(0, toInt(offset, 0)) / size) * size;
  return Math.min(aligned, lastStart);
}

/** The rows of the page starting at `offset` (offset is clamped first). */
export function pageSlice<T>(rows: readonly T[], offset: number, pageSize: number): T[] {
  const size = Math.max(1, toInt(pageSize, 1));
  const start = clampOffset(offset, rows.length, size);
  return rows.slice(start, start + size);
}

/**
 * Window `scrollY` that brings an element whose top is at `rectTop` (viewport coordinates) to
 * `gap` px below a sticky header of `headerOffset` px, or null when its top is already visible
 * below the header (so paging never yanks the view when the list start is on screen).
 */
export function scrollTopFor(
  rectTop: number,
  scrollY: number,
  headerOffset = 0,
  gap = 12,
): number | null {
  if (rectTop >= headerOffset) return null;
  return Math.max(0, Math.round(scrollY + rectTop - headerOffset - gap));
}
