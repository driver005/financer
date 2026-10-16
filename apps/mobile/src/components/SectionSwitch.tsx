import { usePathname, useRouter } from "expo-router";
import { Pressable, ScrollView, Text as RNText } from "react-native";

import { MIN_TOUCH } from "@/a11y";
import { tap } from "@/native/haptics";
import { switchFor } from "@/navigation";
import { radius, space, usePalette } from "@/theme";

/**
 * The switcher under the title of screens that share a tab (Spending | Budget, Prices | Recipes |
 * Meal plan | Usual items). Renders nothing on other screens, so it can be dropped in anywhere.
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
      style={{ flexGrow: 0, marginBottom: space.md }}
      contentContainerStyle={{ gap: space.sm }}
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
            style={{
              minHeight: MIN_TOUCH,
              paddingHorizontal: space.lg,
              borderRadius: radius.pill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: selected ? p.accent : p.surfaceAlt,
            }}
          >
            <RNText style={{ color: selected ? p.onAccent : p.text, fontSize: 15, fontWeight: "700" }}>{item.label}</RNText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
