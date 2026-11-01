// Semantic colours: roles, not shades. A component asks for `text.muted` or `tones.accent.solid`;
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
  /** A recessed fill: inputs, table stripes, tracks of meters. */
  sunken: string;
  scrim: string;
  text: { default: string; muted: string; subtle: string; inverse: string };
  border: { default: string; strong: string; focus: string };
  tones: Record<Tone, ToneColors>;
};

export const lightColors: ThemeColors = {
  background: p.slate[50],
  surface: p.white,
  raised: p.white,
  sunken: p.slate[100],
  scrim: alpha.scrimLight,
  text: { default: p.slate[900], muted: p.slate[600], subtle: p.slate[500], inverse: p.white },
  border: { default: p.slate[200], strong: p.slate[300], focus: p.indigo[600] },
  tones: {
    neutral: { solid: p.slate[900], onSolid: p.white, soft: p.slate[100], onSoft: p.slate[700], text: p.slate[700], line: p.slate[300] },
    accent: { solid: p.indigo[600], onSolid: p.white, soft: p.indigo[50], onSoft: p.indigo[700], text: p.indigo[600], line: p.indigo[200] },
    success: { solid: p.emerald[700], onSolid: p.white, soft: p.emerald[50], onSoft: p.emerald[800], text: p.emerald[700], line: p.emerald[200] },
    warning: { solid: p.amber[700], onSolid: p.white, soft: p.amber[50], onSoft: p.amber[800], text: p.amber[700], line: p.amber[200] },
    danger: { solid: p.red[600], onSolid: p.white, soft: p.red[50], onSoft: p.red[700], text: p.red[600], line: p.red[200] },
    info: { solid: p.sky[700], onSolid: p.white, soft: p.sky[50], onSoft: p.sky[800], text: p.sky[700], line: p.sky[200] },
  },
};

export const darkColors: ThemeColors = {
  background: p.slate[950],
  surface: p.slate[900],
  raised: p.slate[800],
  sunken: p.slate[800],
  scrim: alpha.scrimDark,
  text: { default: p.slate[50], muted: p.slate[300], subtle: p.slate[400], inverse: p.slate[950] },
  border: { default: p.slate[700], strong: p.slate[600], focus: p.indigo[400] },
  tones: {
    neutral: { solid: p.slate[50], onSolid: p.slate[950], soft: p.slate[800], onSoft: p.slate[200], text: p.slate[200], line: p.slate[600] },
    accent: { solid: p.indigo[400], onSolid: p.slate[950], soft: p.indigo[950], onSoft: p.indigo[200], text: p.indigo[300], line: p.indigo[800] },
    success: { solid: p.emerald[400], onSolid: p.slate[950], soft: p.emerald[950], onSoft: p.emerald[300], text: p.emerald[400], line: p.emerald[800] },
    warning: { solid: p.amber[400], onSolid: p.slate[950], soft: p.amber[950], onSoft: p.amber[300], text: p.amber[400], line: p.amber[800] },
    danger: { solid: p.red[400], onSolid: p.slate[950], soft: p.red[950], onSoft: p.red[300], text: p.red[400], line: p.red[800] },
    info: { solid: p.sky[400], onSolid: p.slate[950], soft: p.sky[950], onSoft: p.sky[300], text: p.sky[400], line: p.sky[800] },
  },
};

export type Scheme = "light" | "dark";
export const colorsByScheme: Record<Scheme, ThemeColors> = { light: lightColors, dark: darkColors };
