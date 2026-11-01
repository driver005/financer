import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import type { Tone } from "../constants/colors";
import { size } from "../constants/sizes";
import { radius } from "../constants/radius";
import { alpha } from "../constants/palette";
import { space } from "../constants/spacing";
import { View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";

/** How good a 0..1 score is, as a tone: the colour supports the number beside it. */
export function toneForScore(score: number | null | undefined): Tone {
  if (score === null || score === undefined) return "neutral";
  return score >= 0.7 ? "success" : score >= 0.4 ? "warning" : "danger";
}

export type MeterProps = {
  /** 0 to 1. */
  value: number;
  tone?: Tone;
  /** Thickness. */
  thickness?: keyof typeof size.bar;
  label?: string;
};

/** A horizontal bar for a 0..1 value (also the progress bar). */
export function Meter({ value, tone = "accent", thickness = "md", label }: MeterProps) {
  const { colors } = useTheme();
  const v = Math.min(1, Math.max(0, value));
  const h = size.bar[thickness];
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={{ height: h, borderRadius: radius.full, backgroundColor: colors.sunken, overflow: "hidden", width: "100%" }}
    >
      <View style={{ width: `${v * 100}%`, height: h, borderRadius: radius.full, backgroundColor: colors.tones[tone].solid, paddingHorizontal: space.sm, paddingTop: space["2xs"] }}>
        {/* the light streak along the top of the bar */}
        {thickness === "sm" ? null : <View style={{ height: space.xs, borderRadius: radius.full, backgroundColor: alpha.shine }} />}
      </View>
    </View>
  );
}

/** A label, a value and a bar: one criterion of a product's score. `score` is null when unknown. */
export function MeterRow({ label, value, score }: { label: string; value?: string | null; score: number | null }) {
  return (
    <Box gap="xs">
      <Row justify="between" gap="md">
        <Box grow><Text variant="label" numberOfLines={1}>{label}</Text></Box>
        <Text variant="number" tone={score === null ? "subtle" : "muted"} numberOfLines={1}>{value ?? "unknown"}</Text>
      </Row>
      <Meter value={score ?? 0} tone={toneForScore(score)} thickness="md" label={label} />
    </Box>
  );
}
