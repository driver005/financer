// Semantic colours: roles, not shades. Playful and chunky in the manner of Duolingo: bright faces with a
// darker edge, soft tinted fills with a 2 px line, a blue-green night for the dark theme. A component asks for `text.muted` or `tones.accent.solid`;
// which palette step that is, in light and in dark, is decided here and only here.
// Tests (tests/contrast.test.ts) check these pairs against WCAG 2.2 AA (4.5:1 for text, 3:1 for
// parts of the interface).
import { alpha, duo, palette as p } from "./palette";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
export const tones: readonly Tone[] = ["neutral", "accent", "success", "warning", "danger", "info"];

export type ToneColors = {
  /** Solid fill (buttons, badges): the bright face. */
  solid: string;
  /** The darker colour of the thick lower edge under a solid face. */
  edge: string;
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
  tones: Record<Tone, ToneColors>;
};

const n = p.neutral;
const d = duo.night;
const ink = n[900];

export const lightColors: ThemeColors = {
  background: n[100],
  surface: p.white,
  raised: p.white,
  field: n[50],
  thumb: p.white,
  sunken: n[200],
  scrim: alpha.scrimLight,
  text: { default: n[800], muted: n[700], subtle: n[600], inverse: p.white },
  border: { default: n[200], strong: n[300], focus: duo.blue.text },
  tones: {
    neutral: { solid: n[600], onSolid: p.white, edge: n[800], soft: n[100], onSoft: n[700], text: n[700], line: n[200] },
    accent: { solid: duo.green.face, onSolid: ink, edge: duo.green.edge, soft: duo.green.soft, onSoft: duo.green.onSoft, text: duo.green.text, line: duo.green.line },
    success: { solid: duo.green.face, onSolid: ink, edge: duo.green.edge, soft: duo.green.soft, onSoft: duo.green.onSoft, text: duo.green.text, line: duo.green.line },
    warning: { solid: duo.yellow.face, onSolid: ink, edge: duo.yellow.edge, soft: duo.yellow.soft, onSoft: duo.yellow.onSoft, text: duo.yellow.text, line: duo.yellow.line },
    danger: { solid: duo.red.face, onSolid: ink, edge: duo.red.edge, soft: duo.red.soft, onSoft: duo.red.onSoft, text: duo.red.text, line: duo.red.line },
    info: { solid: duo.blue.face, onSolid: ink, edge: duo.blue.edge, soft: duo.blue.soft, onSoft: duo.blue.onSoft, text: duo.blue.text, line: duo.blue.line },
  },
};

export const darkColors: ThemeColors = {
  background: d.background,
  surface: d.surface,
  raised: d.raised,
  field: d.background,
  thumb: d.text,
  sunken: d.raised,
  scrim: alpha.scrimDark,
  text: { default: d.text, muted: d.muted, subtle: d.subtle, inverse: ink },
  border: { default: d.border, strong: d.borderStrong, focus: duo.blue.face },
  tones: {
    neutral: { solid: d.text, onSolid: ink, edge: d.edgeNeutral, soft: d.raised, onSoft: d.muted, text: d.muted, line: d.border },
    accent: { solid: duo.green.face, onSolid: ink, edge: duo.green.edge, soft: d.green.soft, onSoft: d.green.onSoft, text: duo.green.face, line: d.green.line },
    success: { solid: duo.green.face, onSolid: ink, edge: duo.green.edge, soft: d.green.soft, onSoft: d.green.onSoft, text: duo.green.face, line: d.green.line },
    warning: { solid: duo.yellow.face, onSolid: ink, edge: duo.yellow.edge, soft: d.yellow.soft, onSoft: d.yellow.onSoft, text: duo.yellow.face, line: d.yellow.line },
    danger: { solid: duo.red.face, onSolid: ink, edge: duo.red.edge, soft: d.red.soft, onSoft: d.red.onSoft, text: d.red.text, line: d.red.line },
    info: { solid: duo.blue.face, onSolid: ink, edge: duo.blue.edge, soft: d.blue.soft, onSoft: d.blue.onSoft, text: duo.blue.face, line: d.blue.line },
  },
};

export type Scheme = "light" | "dark";
export const colorsByScheme: Record<Scheme, ThemeColors> = { light: lightColors, dark: darkColors };
