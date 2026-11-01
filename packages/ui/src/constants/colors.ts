// Semantic colours: roles, not shades. Neutral greys and the violet brand of Untitled UI, with HeroUI's
// layering (page, surface, secondary fill) and its soft status fills. A component asks for `text.muted` or `tones.accent.solid`;
// which palette step that is, in light and in dark, is decided here and only here.
// Tests (tests/contrast.test.ts) check these pairs against WCAG 2.2 AA (4.5:1 for text, 3:1 for
// parts of the interface).
import { alpha, palette as p } from "./palette";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
export const tones: readonly Tone[] = ["neutral", "accent", "success", "warning", "danger", "info"];

export type ToneColors = {
  /** Solid fill (buttons, badges). */
  solid: string;
  /** Text and icons on the solid fill. */
  onSolid: string;
  /** Soft tinted fill (chips, banners, selected rows). */
  soft: string;
  /** Text on the soft fill. */
  onSoft: string;
  /** Text and icons of this tone on the plain surface. */
  text: string;
  /** Outline of this tone. */
  line: string;
};

export type ThemeColors = {
  /** The app's background behind everything. */
  background: string;
  /** Cards, sheets, bars. */
  surface: string;
  /** A surface that stands above another one (menus, selected cards). */
  raised: string;
  /** The fill of inputs: white on the light page, the card colour on the dark one. */
  field: string;
  /** The knob of a switch. */
  thumb: string;
  /** A recessed fill: neutral chips, table stripes, tracks of meters, the track of a segmented control. */
  sunken: string;
  scrim: string;
  text: { default: string; muted: string; subtle: string; inverse: string };
  border: { default: string; strong: string; focus: string };
  /** Untitled UI's focus ring: a 4 px halo in the palest brand tint, as a `boxShadow`. */
  focusRing: string;
  /** The same halo for a field in error. */
  dangerRing: string;
  tones: Record<Tone, ToneColors>;
};

export const lightColors: ThemeColors = {
  background: p.neutral[100],
  surface: p.white,
  raised: p.white,
  field: p.white,
  thumb: p.white,
  sunken: p.neutral[200],
  scrim: alpha.scrimLight,
  text: { default: p.neutral[900], muted: p.neutral[700], subtle: p.neutral[600], inverse: p.white },
  border: { default: p.neutral[200], strong: p.neutral[300], focus: p.brand[600] },
  focusRing: `0 0 0 4px ${p.brand[100]}`,
  dangerRing: `0 0 0 4px ${p.red[100]}`,
  tones: {
    neutral: { solid: p.neutral[900], onSolid: p.white, soft: p.neutral[100], onSoft: p.neutral[700], text: p.neutral[700], line: p.neutral[300] },
    accent: { solid: p.brand[600], onSolid: p.white, soft: p.brand[50], onSoft: p.brand[700], text: p.brand[600], line: p.brand[200] },
    success: { solid: p.green[700], onSolid: p.white, soft: p.green[50], onSoft: p.green[700], text: p.green[700], line: p.green[200] },
    warning: { solid: p.yellow[700], onSolid: p.white, soft: p.yellow[50], onSoft: p.yellow[700], text: p.yellow[700], line: p.yellow[200] },
    danger: { solid: p.red[600], onSolid: p.white, soft: p.red[50], onSoft: p.red[700], text: p.red[700], line: p.red[200] },
    info: { solid: p.sky[700], onSolid: p.white, soft: p.sky[50], onSoft: p.sky[800], text: p.sky[700], line: p.sky[200] },
  },
};

export const darkColors: ThemeColors = {
  background: p.neutral[950],
  surface: p.neutral[900],
  raised: p.neutral[800],
  field: p.neutral[900],
  thumb: p.neutral[50],
  sunken: p.neutral[800],
  scrim: alpha.scrimDark,
  text: { default: p.neutral[50], muted: p.neutral[300], subtle: p.neutral[400], inverse: p.neutral[950] },
  border: { default: p.neutral[800], strong: p.neutral[600], focus: p.brand[400] },
  focusRing: `0 0 0 4px ${p.brand[900]}`,
  dangerRing: `0 0 0 4px ${p.red[950]}`,
  tones: {
    neutral: { solid: p.neutral[50], onSolid: p.neutral[950], soft: p.neutral[800], onSoft: p.neutral[200], text: p.neutral[200], line: p.neutral[600] },
    accent: { solid: p.brand[400], onSolid: p.neutral[950], soft: p.brand[950], onSoft: p.brand[200], text: p.brand[300], line: p.brand[800] },
    success: { solid: p.green[400], onSolid: p.neutral[950], soft: p.green[950], onSoft: p.green[300], text: p.green[400], line: p.green[800] },
    warning: { solid: p.yellow[400], onSolid: p.neutral[950], soft: p.yellow[950], onSoft: p.yellow[300], text: p.yellow[400], line: p.yellow[800] },
    danger: { solid: p.red[400], onSolid: p.neutral[950], soft: p.red[950], onSoft: p.red[300], text: p.red[400], line: p.red[800] },
    info: { solid: p.sky[400], onSolid: p.neutral[950], soft: p.sky[950], onSoft: p.sky[300], text: p.sky[400], line: p.sky[800] },
  },
};

export type Scheme = "light" | "dark";
export const colorsByScheme: Record<Scheme, ThemeColors> = { light: lightColors, dark: darkColors };
