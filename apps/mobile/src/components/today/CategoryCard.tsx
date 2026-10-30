import { useRouter } from "expo-router";
import { Text as RNText, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { ChunkyButton } from "@/components/kit";
import { Card } from "@/components/ui";
import { formatMoney, spokenMoney } from "@/format";
import { periodLabel } from "@/period";
import { categoryShares, donutArcs, sharesSummary } from "@/todayCharts";
import { space, tabular, typography, usePalette } from "@/theme";

const SIZE = 132;
const STROKE = 18;

/**
 * Where the period's money went: a donut with the total in the middle and, beside it, one legend
 * row per category with its amount and share. The colours only tell the slices apart; every row
 * names its category, so nothing depends on telling hues apart.
 */
export function CategoryCard({
  txs,
  period,
}: {
  txs: { booking_date: string; amount_cents: number; category?: string | null }[];
  period: { start: string; end: string };
}) {
  const p = usePalette();
  const router = useRouter();
  const { total, shares } = categoryShares(txs, period, 5);
  if (shares.length === 0) return null;

  // distinct hues from the palette; the folded "other" slice is grey
  const hues = [p.fill, p.blue, p.good, p.orange, p.gold];
  const colourOf = (category: string, i: number) => (category === "other" ? p.muted : hues[i % hues.length]);
  const r = (SIZE - STROKE) / 2;
  const arcs = donutArcs(shares.map((s) => s.share), r, 4);

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
        <View style={{ flexShrink: 1 }}>
          <RNText accessibilityRole="header" style={[typography.bodyStrong, { color: p.text }]}>Where it went</RNText>
          <RNText style={[typography.caption, { color: p.muted }]}>{periodLabel(period)}</RNText>
        </View>
        <ChunkyButton compact flat label="All spending" onPress={() => router.push("/spending")} />
      </View>

      <View accessible accessibilityRole="image" accessibilityLabel={sharesSummary(total, shares)} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.lg, marginTop: space.md }}>
        <View style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" }}>
          <Svg width={SIZE} height={SIZE} style={{ position: "absolute" }}>
            <Circle cx={SIZE / 2} cy={SIZE / 2} r={r} stroke={p.accentSoft} strokeWidth={STROKE} fill="none" />
            {shares.map((s, i) => (
              <Circle
                key={s.category}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={r}
                stroke={colourOf(s.category, i)}
                strokeWidth={STROKE}
                strokeLinecap="butt"
                fill="none"
                strokeDasharray={arcs[i].dash}
                strokeDashoffset={arcs[i].offset}
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              />
            ))}
          </Svg>
          <RNText style={[typography.caption, { color: p.muted }]}>Spent</RNText>
          <RNText style={[typography.bodyStrong, tabular, { color: p.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {formatMoney(total)}
          </RNText>
        </View>

        <View style={{ flex: 1, minWidth: 170, gap: space.sm }}>
          {shares.map((s, i) => (
            <View key={s.category} style={{ flexDirection: "row", alignItems: "center", gap: space.sm }} accessibilityLabel={`${s.label}: ${spokenMoney(s.cents)}, ${Math.round(s.share * 100)} percent`}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colourOf(s.category, i) }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <RNText style={[typography.label, { color: p.text }]} numberOfLines={1}>
                  {s.label}
                </RNText>
                <RNText style={[typography.caption, tabular, { color: p.muted }]} numberOfLines={1}>
                  {formatMoney(s.cents)}
                </RNText>
              </View>
              <RNText style={[typography.label, tabular, { color: p.text }]} numberOfLines={1}>
                {Math.round(s.share * 100)} %
              </RNText>
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}
