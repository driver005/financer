// Opacity, stacking and motion: Tailwind CSS 3.4.17 `opacity`, `zIndex` and `transitionDuration`.
export const opacity = { 0: 0, 5: 0.05, 10: 0.1, 25: 0.25, 40: 0.4, 50: 0.5, 60: 0.6, 75: 0.75, 90: 0.9, 100: 1 } as const;
export const zIndex = { base: 0, raised: 10, sticky: 20, nav: 30, overlay: 40, modal: 50 } as const;
export const duration = { instant: 75, fast: 150, base: 200, slow: 300, slower: 500 } as const;

/** Interaction states of controls. */
export const state = { pressed: opacity[90], disabled: opacity[40], loading: opacity[75], pressScale: 0.97 } as const;

export type Opacity = keyof typeof opacity;

/** How far a one-line text may shrink to fit (`Text fit`), and how far the system font size may enlarge it. */
export const fitScale = { min: 0.6, max: 1.2 } as const;

/** Events that overlap in the calendar lie on top of each other, each one `indent` percent further right, together at most `spread` percent. */
export const overlap = { indent: 12, spread: 60 } as const;
