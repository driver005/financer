import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Text as RNText, View } from "react-native";

import { Avatar, Badge, Money, space, radius, useTones } from "@/components/grocery/primitives";
import { chainTint, initials } from "@/groceryView";
import { chainLabel } from "@/hooks";
import { usePalette } from "@/theme";

/**
 * One chain in a price comparison: avatar, name, what the price is for, and the price on the
 * right. The cheapest chain is tinted and carries a badge; the others show how much more they cost.
 */
export function ChainPriceRow({
  chain,
  detail,
  priceText,
  extraText,
  isCheapest,
  isOffer,
  note,
  accessibilityLabel,
}: {
  chain: string;
  /** Product name or pack line under the chain name. */
  detail?: string;
  priceText: string;
  /** `+0,06 €` for a dearer chain. */
  extraText?: string;
  isCheapest?: boolean;
  isOffer?: boolean;
  /** Smaller line at the bottom (validity, source). */
  note?: string;
  accessibilityLabel: string;
}) {
  const p = usePalette();
  const tones = useTones();
  const name = chainLabel(chain);
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: isCheapest ? tones.good.border : "transparent",
        backgroundColor: isCheapest ? tones.good.bg : p.surfaceAlt,
      }}
    >
      <Avatar tint={chainTint(chain)} label={initials(name)} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
          <RNText style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{name}</RNText>
          {isCheapest ? <Badge tone="good" label="Cheapest" icon="star" /> : null}
          {isOffer ? <Badge tone="offer" label="Offer" icon="tag" /> : null}
        </View>
        {detail ? (
          <RNText style={{ color: p.muted, fontSize: 13 }} numberOfLines={2}>
            {detail}
          </RNText>
        ) : null}
        {note ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <MaterialCommunityIcons name="clock-outline" size={12} color={p.muted} />
            <RNText style={{ color: p.muted, fontSize: 12, flexShrink: 1 }}>{note}</RNText>
          </View>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Money text={priceText} size="lg" color={isCheapest ? tones.good.fg : p.text} />
        {extraText ? <RNText style={{ color: p.muted, fontSize: 12, fontVariant: ["tabular-nums"] }}>{extraText}</RNText> : null}
      </View>
    </View>
  );
}
