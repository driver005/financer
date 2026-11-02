import { usePathname, useRouter } from "expo-router";
import { Pressable, ScrollView, Text as RNText, View } from "react-native";

import { MIN_TOUCH } from "@/a11y";
import { tap } from "@/native/haptics";
import { switchFor } from "@/navigation";
import { space, usePalette } from "@/theme";

/**
 * The tab strip under the title of screens that share a tab (Spending | Budget, Prices | Recipes |
 * Meal plan | Usual items): plain text, the open one in the accent colour with a line under it,
 * the whole strip closed by a hairline. Renders nothing on other screens, so it can be dropped in
 * anywhere.
 */
export function SectionSwitch() {
  const p = usePalette();
  const router = useRouter();
  const current = switchFor(usePathname());
  if (!current) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      style={{ flexGrow: 0, flexShrink: 0, marginBottom: space.md, borderBottomWidth: 1, borderBottomColor: p.border }}
      contentContainerStyle={{ gap: space.xl }}
    >
      {current.items.map((item) => {
        const selected = item.href === current.active;
        return (
          <Pressable
            key={item.href}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              tap();
              if (!selected) router.replace(item.href as never);
            }}
            style={{ minHeight: MIN_TOUCH, justifyContent: "center" }}
          >
            <RNText style={{ color: selected ? p.accent : p.muted, fontSize: 15, fontWeight: selected ? "800" : "600" }}>{item.label}</RNText>
            <View style={{ position: "absolute", left: 0, right: 0, bottom: -1, height: 2, backgroundColor: selected ? p.accent : "transparent" }} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
