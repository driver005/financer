import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useClientPage } from "@/hooks/use-client-page";
import { clampOffset, fetchAll, pageSlice, scrollTopFor } from "@/lib/paginate";

/** Fake PostgREST: serves `total` rows but never more than `maxRows` per response. */
function fakeTable(total: number, maxRows = 1000) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const build = (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + maxRows);
    return Promise.resolve({ data: rows.slice(from, end), error: null });
  };
  return { build, calls };
}

describe("fetchAll (PostgREST paging)", () => {
  it("returns everything past the 1000-row cap", async () => {
    const t = fakeTable(2500);
    const res = await fetchAll<{ id: number }>(t.build);
    expect(res.error).toBeNull();
    expect(res.data).toHaveLength(2500);
    expect(res.data!.map((r) => r.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops after a single short page", async () => {
    const t = fakeTable(7);
    const res = await fetchAll(t.build);
    expect(res.data).toHaveLength(7);
    expect(t.calls).toEqual([[0, 999]]);
  });

  it("asks one more page when the last page was exactly full", async () => {
    const t = fakeTable(2000);
    const res = await fetchAll(t.build);
    expect(res.data).toHaveLength(2000);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("handles an empty result", async () => {
    const t = fakeTable(0);
    expect((await fetchAll(t.build)).data).toEqual([]);
    expect(t.calls).toHaveLength(1);
  });

  it("respects the hard cap and a custom page size", async () => {
    const t = fakeTable(100, 1000);
    const res = await fetchAll(t.build, { pageSize: 10, hardCap: 25 });
    expect(res.data).toHaveLength(25);
    expect(t.calls).toEqual([
      [0, 9],
      [10, 19],
      [20, 24],
    ]);
  });

  it("treats a server cap smaller than the page size as a short page", async () => {
    const t = fakeTable(50, 20);
    const res = await fetchAll(t.build, { pageSize: 100 });
    expect(res.data).toHaveLength(20);
    expect(t.calls).toEqual([[0, 99]]);
  });

  it("returns the first error and stops paging", async () => {
    const calls: number[] = [];
    const build = (from: number, to: number) => {
      calls.push(from);
      if (from === 0)
        return Promise.resolve({
          data: Array.from({ length: to - from + 1 }, (_, i) => i),
          error: null,
        });
      return Promise.resolve({ data: null, error: { message: "boom" } });
    };
    const res = await fetchAll(build, { pageSize: 5 });
    expect(res).toEqual({ data: null, error: { message: "boom" } });
    expect(calls).toEqual([0, 5]);
  });

  it("works with lazy thenables like Supabase query builders", async () => {
    const thenable = (data: unknown[]) =>
      ({
        then: (ok: (v: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve(ok({ data, error: null })),
      }) as unknown as PromiseLike<{ data: unknown[]; error: null }>;
    const res = await fetchAll((from) => thenable(from === 0 ? [1, 2] : []), { pageSize: 2 });
    expect(res.data).toEqual([1, 2]);
  });
});

describe("clampOffset", () => {
  it("keeps a valid page start", () => {
    expect(clampOffset(0, 50, 20)).toBe(0);
    expect(clampOffset(20, 50, 20)).toBe(20);
    expect(clampOffset(40, 50, 20)).toBe(40);
  });

  it("falls back to the new last page when the list shrinks", () => {
    // 41 rows → last page starts at 40; deleting that row leaves 40 rows → last page starts at 20.
    expect(clampOffset(40, 40, 20)).toBe(20);
    expect(clampOffset(100, 5, 20)).toBe(0);
  });

  it("aligns offsets to page boundaries and rejects junk", () => {
    expect(clampOffset(25, 50, 20)).toBe(20);
    expect(clampOffset(-10, 50, 20)).toBe(0);
    expect(clampOffset(Number.NaN, 50, 20)).toBe(0);
    expect(clampOffset(10, 0, 20)).toBe(0);
    expect(clampOffset(3, 10, 0)).toBe(3); // page size floors to 1
  });
});

describe("pageSlice", () => {
  const rows = Array.from({ length: 25 }, (_, i) => i);

  it("returns the rows of one page", () => {
    expect(pageSlice(rows, 0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(pageSlice(rows, 20, 10)).toEqual([20, 21, 22, 23, 24]);
  });

  it("clamps an out-of-range offset to the last page", () => {
    expect(pageSlice(rows, 90, 10)).toEqual([20, 21, 22, 23, 24]);
    expect(pageSlice([], 30, 10)).toEqual([]);
  });

  it("does not mutate the input", () => {
    const copy = [...rows];
    pageSlice(rows, 10, 10);
    expect(rows).toEqual(copy);
  });
});

describe("scrollTopFor", () => {
  it("does nothing when the target top is already visible", () => {
    expect(scrollTopFor(0, 800)).toBeNull();
    expect(scrollTopFor(120, 800, 56)).toBeNull();
    expect(scrollTopFor(56, 800, 56)).toBeNull();
  });

  it("scrolls up so the target sits just below the sticky header", () => {
    expect(scrollTopFor(-400, 1000, 0, 12)).toBe(588);
    expect(scrollTopFor(-400, 1000, 56, 12)).toBe(532);
    expect(scrollTopFor(10, 1000, 56, 12)).toBe(942);
  });

  it("never returns a negative position", () => {
    expect(scrollTopFor(-50, 20, 56)).toBe(0);
  });
});

describe("useClientPage", () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("pages through rows and clamps setOffset", () => {
    const { result } = renderHook(() => useClientPage(list(25), 10));
    expect(result.current.visible).toEqual(list(10));
    expect(result.current.total).toBe(25);
    act(() => result.current.setOffset(20));
    expect(result.current.visible).toEqual([20, 21, 22, 23, 24]);
    act(() => result.current.setOffset(500));
    expect(result.current.offset).toBe(20);
  });

  it("falls back a page when the last page is emptied", () => {
    const { result, rerender } = renderHook(({ rows }) => useClientPage(rows, 10), {
      initialProps: { rows: list(21) },
    });
    act(() => result.current.setOffset(20));
    expect(result.current.visible).toEqual([20]);
    rerender({ rows: list(20) });
    expect(result.current.offset).toBe(10);
    expect(result.current.visible).toEqual(list(20).slice(10));
  });

  it("resets to the first page when the reset key changes", () => {
    const rows = list(30);
    const { result, rerender } = renderHook(({ k }) => useClientPage(rows, 10, k), {
      initialProps: { k: 30 },
    });
    act(() => result.current.setOffset(20));
    rerender({ k: 7 });
    expect(result.current.offset).toBe(0);
    expect(result.current.visible).toEqual(list(10));
  });
});
