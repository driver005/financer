// The small maths behind the charts: bar rectangles and ring arcs. Pure, so it is unit-tested.

export type Bar = { x: number; y: number; width: number; height: number };

/**
 * Bars for `values` in a `width` x `height` box, `gap` apart. A bar is at least `min` tall when its
 * value is above 0, so a small amount stays visible next to a big one; a zero value has height 0.
 * `max` lets several charts share one scale.
 */
export function barRects(values: number[], width: number, height: number, gap: number, min: number, max?: number): Bar[] {
  if (values.length === 0) return [];
  const top = max ?? Math.max(...values, 0);
  const barW = Math.max(1, (width - gap * (values.length - 1)) / values.length);
  return values.map((v, i) => {
    const h = top > 0 && v > 0 ? Math.max(min, (height * v) / top) : 0;
    return { x: i * (barW + gap), y: height - h, width: barW, height: h };
  });
}

export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}

/** A ring that fits inside a `box` x `box` square with a stroke of `stroke` width, so nothing is clipped. */
export function ringGeometry(box: number, stroke: number): { c: number; r: number; circumference: number } {
  const r = Math.max(0, (box - stroke) / 2);
  return { c: box / 2, r, circumference: 2 * Math.PI * r };
}

/** `strokeDashoffset` that leaves `progress` (0..1) of the circle drawn. */
export function dashOffset(circumference: number, progress: number): number {
  return circumference * (1 - clamp01(progress));
}

/** Points of a line over `values`, scaled into a box with `pad` on every side; the axis starts at 0. */
export function sparkPoints(values: number[], width: number, height: number, pad: number): { x: number; y: number }[] {
  if (values.length === 0) return [];
  const max = Math.max(...values, 0);
  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - pad * 2);
  return values.map((v, i) => ({
    x: values.length === 1 ? width / 2 : pad + (innerW * i) / (values.length - 1),
    y: pad + innerH - (max > 0 ? (innerH * Math.max(0, v)) / max : 0),
  }));
}
