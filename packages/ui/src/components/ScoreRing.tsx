import Svg, { Circle } from "react-native-svg";

import type { Tone } from "../constants/colors";
import { size } from "../constants/sizes";
import { Box } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { useTheme } from "../theme/ThemeProvider";
import { toneForScore } from "./Meter";

export type ScoreRingProps = {
  /** 0 to 100. */
  score: number;
  size?: keyof typeof size.ring;
  tone?: Tone;
  /** Caption under the number (large only). */
  caption?: string;
};

/** The overall score as a ring with the number inside. */
export function ScoreRing({ score, size: s = "md", tone, caption }: ScoreRingProps) {
  const { colors } = useTheme();
  const d = size.ring[s];
  const stroke = size.ringStroke[s];
  const r = (d - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, score / 100));
  const color = colors.tones[tone ?? toneForScore(v)].solid;
  return (
    <Box dim={`ring-${s}`} align="center" justify="center" accessibilityRole="progressbar" accessibilityLabel={`Score ${Math.round(score)} of 100`} accessibilityValue={{ min: 0, max: 100, now: Math.round(score) }}>
      <Svg width={d} height={d} style={{ position: "absolute" }}>
        <Circle cx={d / 2} cy={d / 2} r={r} stroke={colors.sunken} strokeWidth={stroke} fill="none" />
        <Circle
          cx={d / 2}
          cy={d / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          transform={`rotate(-90 ${d / 2} ${d / 2})`}
        />
      </Svg>
      <Text variant={s === "lg" ? "title" : s === "md" ? "number" : "caption"}>{Math.round(score)}</Text>
      {caption && s === "lg" ? <Text variant="caption" tone="muted">{caption}</Text> : null}
    </Box>
  );
}
