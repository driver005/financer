import { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";

import { size } from "../constants/sizes";
import { borderWidth } from "../constants/radius";
import { space } from "../constants/spacing";
import type { Tone } from "../constants/colors";
import { Box } from "../primitives/Box";
import { useTheme } from "../theme/ThemeProvider";

/** A line through values over time (price history). Fills the width it is given. */
export function Sparkline({ values, tone = "accent", height = "md", label, markLowest }: { values: number[]; tone?: Tone; height?: keyof typeof size.chart; label?: string; /** Ring the lowest value in green. */ markLowest?: boolean }) {
  const { colors } = useTheme();
  const [w, setW] = useState(0);
  const h = size.chart[height];
  const pad = space.sm;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => pad + (values.length <= 1 ? 0 : (i / (values.length - 1)) * (w - pad * 2));
  const y = (v: number) => (hi === lo ? h / 2 : pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2));
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = values.length - 1;
  return (
    <Box accessibilityRole="image" accessibilityLabel={label ?? "Price history"} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <View style={{ height: h }}>
        {w > 0 && values.length > 1 ? (
          <Svg width={w} height={h}>
            <Polyline points={points} fill="none" stroke={colors.tones[tone].solid} strokeWidth={borderWidth.thick} strokeLinejoin="round" strokeLinecap="round" />
            {markLowest ? <Circle cx={x(values.indexOf(lo))} cy={y(lo)} r={space.sm} fill={colors.tones.success.soft} stroke={colors.tones.success.solid} strokeWidth={borderWidth.thick} /> : null}
            <Circle cx={x(last)} cy={y(values[last])} r={space.xs} fill={colors.tones[tone].solid} />
          </Svg>
        ) : null}
      </View>
    </Box>
  );
}
