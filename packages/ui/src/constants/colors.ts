// Semantic colours: roles, not shades. HeroUI's layering (page, white surface, grey fill, soft status
// fills) so the shopping app matches the finance app. A component asks for `text.muted` or
// `tones.accent.solid`; which colour that is, in light and in dark, is decided here and only here.
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
  /** Colours drawn over a photo or a camera picture (the same in both schemes): the ink, a dark chip behind text, the backdrop. */
  media: { ink: string; chip: string; backdrop: string };
  text: { default: string; muted: string; subtle: string; inverse: string };
  border: { default: string; strong: string; focus: string };
  tones: Record<Tone, ToneColors>;
};

const L = p.hero.light;
const D = p.hero.dark;

export const lightColors: ThemeColors = {
  background: L.background,
  surface: L.surface,
  raised: L.surface,
  field: L.surface,
  thumb: p.white,
  sunken: L.fill,
  scrim: alpha.scrimLight,
  media: { ink: p.white, chip: alpha.chip, backdrop: p.black },
  text: { default: L.text, muted: L.muted, subtle: L.subtle, inverse: p.snow },
  border: { default: L.border, strong: L.separator, focus: L.accent.text },
  tones: {
    neutral: { solid: p.eclipse, onSolid: p.snow, soft: L.fill, onSoft: L.text, text: L.text, line: L.border },
    accent: { solid: L.accent.face, onSolid: p.snow, soft: L.accent.soft, onSoft: L.accent.onSoft, text: L.accent.text, line: L.accent.line },
    success: { solid: L.success.face, onSolid: p.eclipse, soft: L.success.soft, onSoft: L.success.onSoft, text: L.success.text, line: L.success.line },
    warning: { solid: L.warning.face, onSolid: p.eclipse, soft: L.warning.soft, onSoft: L.warning.onSoft, text: L.warning.text, line: L.warning.line },
    danger: { solid: L.danger.face, onSolid: p.snow, soft: L.danger.soft, onSoft: L.danger.onSoft, text: L.danger.text, line: L.danger.line },
    info: { solid: p.sky[700], onSolid: p.white, soft: p.sky[50], onSoft: p.sky[800], text: p.sky[700], line: p.sky[200] },
  },
};

export const darkColors: ThemeColors = {
  background: D.background,
  surface: D.surface,
  raised: D.surfaceSecondary,
  field: D.surface,
  thumb: p.snow,
  sunken: D.fill,
  scrim: alpha.scrimDark,
  media: { ink: p.white, chip: alpha.chip, backdrop: p.black },
  text: { default: D.text, muted: D.muted, subtle: D.subtle, inverse: p.eclipse },
  border: { default: D.border, strong: D.separator, focus: D.accent.text },
  tones: {
    neutral: { solid: p.snow, onSolid: p.eclipse, soft: D.fill, onSoft: D.muted, text: D.muted, line: D.border },
    accent: { solid: D.accent.face, onSolid: p.snow, soft: D.accent.soft, onSoft: D.accent.onSoft, text: D.accent.text, line: D.accent.line },
    success: { solid: D.success.face, onSolid: p.eclipse, soft: D.success.soft, onSoft: D.success.onSoft, text: D.success.text, line: D.success.line },
    warning: { solid: D.warning.face, onSolid: p.eclipse, soft: D.warning.soft, onSoft: D.warning.onSoft, text: D.warning.text, line: D.warning.line },
    danger: { solid: D.danger.face, onSolid: p.snow, soft: D.danger.soft, onSoft: D.danger.onSoft, text: D.danger.text, line: D.danger.line },
    info: { solid: p.sky[400], onSolid: p.eclipse, soft: p.sky[950], onSoft: p.sky[300], text: p.sky[400], line: p.sky[800] },
  },
};

export type Scheme = "light" | "dark";
export const colorsByScheme: Record<Scheme, ThemeColors> = { light: lightColors, dark: darkColors };
