import { Pressable, Text, View } from "react-native";

import type { Transaction } from "@/api/client";
import { Body, Card, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";

/** One transaction in the spending list. Tap to recategorize or split it. */
export function TransactionRow({ item, split, onPress }: { item: Transaction; split?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.counterparty || "Unknown"}, ${formatCents(item.amount_cents)}. Change category or split`}
    >
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Body bold>{item.counterparty || "Unknown"}</Body>
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>
              {formatDate(item.booking_date)} · {split ? "split" : (item.category ?? "uncategorized")}
            </Text>
          </View>
          <Text style={{ color: item.amount_cents < 0 ? c.text : c.good, fontSize: 16, fontWeight: "600" }}>
            {formatCents(item.amount_cents)}
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}
