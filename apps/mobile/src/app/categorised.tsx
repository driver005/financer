import React from "react";
import { useRouter } from "expo-router";
import { Card, FadeIn, FgCategoryChip, FgCategoryPill, FgHeaderIcon, FgMerchantRow, FgScreen } from "@finance/ui";

const MERCHANTS = [
  { emoji: "🅰️", name: "Telekom", category: "Internet & Phone", color: "#FCE4F0" },
  { emoji: "🟢", name: "Spotify", category: "Streaming", color: "#E4F7E9" },
  { emoji: "🅽", name: "Netflix", category: "Series & Movies", color: "#FFE5E5" },
  { emoji: "a", name: "Amazon", category: "Shopping", color: "#FFF1DC" },
  { emoji: "🏠", name: "Airbnb", category: "Vacation", color: "#FFE8E8" },
  { emoji: "🚆", name: "Deutsche Bahn", category: "Bus & Train", color: "#FFE5E5" },
  { emoji: "🛒", name: "REWE", category: "Supermarket", color: "#FFE8E8" },
];

export default function CategorisedScreen() {
  const router = useRouter();
  return (
    <FgScreen
      title="Automatically categorised"
      actions={<FgHeaderIcon name="cog-outline" label="Settings" onPress={() => router.push("/settings")} />}
    >
      <FadeIn>
        <Card style={{ gap: 12, alignItems: "center" }}>
          <FgCategoryChip emoji="🏠" label="Living" align="right" />
          <FgCategoryChip emoji="😊" label="Leisure" align="left" />
          <FgCategoryChip emoji="🥤" label="Food & Drinks" />
        </Card>
      </FadeIn>
      <FadeIn delay={80}>
        <Card style={{ paddingHorizontal: 8 }}>
          {MERCHANTS.map((merchant) => (
            <FgMerchantRow
              key={merchant.name}
              emoji={merchant.emoji}
              name={merchant.name}
              logoColor={merchant.color}
              pill={<FgCategoryPill label={merchant.category} />}
            />
          ))}
        </Card>
      </FadeIn>
    </FgScreen>
  );
}
