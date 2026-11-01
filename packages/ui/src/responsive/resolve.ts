// Responsive values: any token prop can be a single value or one per breakpoint, cascading upward
// like Tailwind's `md:` prefixes. Pure functions, no React Native.
import { type Breakpoint, breakpointFor, breakpointOrder } from "../constants/breakpoints";

export type Responsive<T> = T | Partial<Record<Breakpoint, T>>;

const KEYS = new Set<string>(breakpointOrder);

function isMap<T>(v: Responsive<T>): v is Partial<Record<Breakpoint, T>> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => KEYS.has(k));
}

/** The value for a window width: the one of the largest breakpoint at or below it. */
export function resolve<T>(value: Responsive<T>, width: number): T | undefined {
  if (!isMap(value)) return value as T;
  const at = breakpointFor(width);
  const upTo = breakpointOrder.indexOf(at);
  for (let i = upTo; i >= 0; i -= 1) {
    const v = value[breakpointOrder[i]];
    if (v !== undefined) return v;
  }
  return undefined;
}
