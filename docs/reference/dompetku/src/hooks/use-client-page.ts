import { useState } from "react";
import { clampOffset, pageSlice } from "@/lib/paginate";

export type ClientPage<T> = {
  offset: number;
  setOffset: (offset: number) => void;
  visible: T[];
  total: number;
  pageSize: number;
};

/**
 * Client-side pagination of an already-loaded list (render only; the query keeps the full data).
 * The offset is clamped whenever the list shrinks (e.g. deleting the last row of the last page)
 * and reset to the first page whenever `resetKey` changes (pass the page's filter values).
 */
export function useClientPage<T>(
  rows: readonly T[],
  pageSize: number,
  resetKey?: unknown,
): ClientPage<T> {
  const [offset, setRawOffset] = useState(0);
  const [key, setKey] = useState(resetKey);
  const total = rows.length;
  let current = offset;
  // Adjust state during render (React's "storing information from previous renders" pattern).
  if (!Object.is(key, resetKey)) {
    setKey(resetKey);
    current = 0;
    if (offset !== 0) setRawOffset(0);
  } else {
    const clamped = clampOffset(offset, total, pageSize);
    if (clamped !== offset) {
      current = clamped;
      setRawOffset(clamped);
    }
  }
  return {
    offset: current,
    setOffset: (next) => setRawOffset(clampOffset(next, total, pageSize)),
    visible: pageSlice(rows, current, pageSize),
    total,
    pageSize,
  };
}
