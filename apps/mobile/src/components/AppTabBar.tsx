import { MaterialCommunityIcons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { Pressable, Text as RNText, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MIN_TOUCH } from "@/a11y";
import { tap } from "@/native/haptics";
import { TABS, areaFor, tabFor } from "@/navigation";
import { space, usePalette } from "@/theme";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/**
 * The bottom bar: three tabs. A tab stays selected on every screen that belongs to it (Budget
 * lights up Money, Recipes lights up Groceries), which the stock tab bar cannot do for routes it
 * does not list, so the bar is drawn here and reads the current path.
 */
export function AppTabBar() {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const narrow = useWindowDimensions().width < 360;
  if (areaFor(pathname) !== "tab") return null;
  const active = tabFor(pathname);
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        backgroundColor: p.surface,
        borderTopWidth: 1,
        borderTopColor: p.border,
        paddingTop: space.sm,
        // the system's bottom inset (home indicator) goes inside the bar, not onto the labels
        paddingBottom: insets.bottom + space.xs,
      }}
    >
      {TABS.map((t) => {
        const selected = t.id === active;
        const colour = selected ? p.accent : p.muted;
        return (
          <Pressable
            key={t.id}
            accessibilityRole="tab"
            accessibilityLabel={t.title}
            accessibilityState={{ selected }}
            onPress={() => {
              tap();
              if (!selected) router.navigate(t.href as never);
            }}
            style={{ flex: 1, minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center", gap: 2 }}
          >
            <View style={{ width: 52, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: selected ? p.accentSoft : "transparent" }}>
              <MaterialCommunityIcons name={t.icon as IconName} size={24} color={colour} />
            </View>
            <RNText style={{ color: colour, fontSize: narrow ? 11 : 12, lineHeight: 16, fontWeight: selected ? "800" : "600" }}>{t.title}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}
