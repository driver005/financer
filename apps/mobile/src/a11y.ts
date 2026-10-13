/**
 * Accessibility helpers that need no React Native, so they can be unit-tested in plain Node:
 * WCAG contrast ratios and the touch-target minimum.
 */

/** Smallest touch target in points (Apple HIG 44pt, Material 48dp; we use the stricter of the two for primary actions). */
export const MIN_TOUCH = 44;

/** WCAG AA contrast for normal text. */
export const AA_TEXT = 4.5;
/** WCAG AA contrast for large text and UI components (borders of controls, icons). */
export const AA_LARGE = 3;

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** `#rgb` or `#rrggbb` to `[r, g, b]` (0-255). Throws on anything else, so a typo in the palette fails the test. */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a hex colour: ${hex}`);
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Relative luminance as defined by WCAG 2.x. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mix `fg` over `bg` at `alpha` (0-1): the colour a translucent tint ends up as. */
export function blend(fg: string, bg: string, alpha: number): string {
  const f = parseHex(fg);
  const b = parseHex(bg);
  const mix = f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
