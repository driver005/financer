import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { View, useWindowDimensions, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ApiProvider } from "@/api/config";
import { AppLockOverlay } from "@/components/AppLockOverlay";
import { BackupOnOpen } from "@/components/BackupOnOpen";
import "@/native/background"; // defines the background task at startup
import { NotificationSync } from "@/components/NotificationSync";
import { OnboardingGate } from "@/components/OnboardingGate";
import "@/global.css";
import { elevation, space, usePalette } from "@/theme";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

/** A tab with a soft pill behind the icon of the selected one (so colour is not the only cue). */
function tab(title: string, icon: IconName, pill: string) {
  return {
    title,
    tabBarIcon: ({ color, focused }: { color: ColorValue; size: number; focused: boolean }) => (
      <View style={{ width: 56, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: focused ? pill : "transparent" }}>
        <MaterialCommunityIcons name={icon} color={color as string} size={24} />
      </View>
    ),
  };
}

export default function RootLayout() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const narrow = useWindowDimensions().width < 360; // six labels must fit on small phones
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider config={{ toast: { defaultProps: { placement: "bottom" } } }}>
      <ApiProvider>
        <NotificationSync />
        <OnboardingGate />
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: p.accent,
            tabBarInactiveTintColor: p.muted,
            tabBarStyle: {
              backgroundColor: p.surface,
              borderTopWidth: 2,
              borderTopColor: p.border,
              // the system's bottom inset (home indicator) goes inside the bar, not onto the labels
              height: 72 + insets.bottom,
              paddingTop: space.sm,
              paddingBottom: insets.bottom + space.xs,
              ...elevation.raised,
            },
            tabBarItemStyle: { minHeight: 48 },
            tabBarLabelStyle: { fontSize: narrow ? 10 : 11, lineHeight: 14, fontWeight: "700", marginTop: 2 },
          }}
        >
          <Tabs.Screen name="index" options={tab("Today", "home-variant", p.accentSoft)} />
          <Tabs.Screen name="spending" options={tab("Spending", "swap-vertical", p.accentSoft)} />
          <Tabs.Screen name="budget" options={tab("Budget", "wallet-outline", p.accentSoft)} />
          <Tabs.Screen name="prices" options={tab("Prices", "tag-multiple-outline", p.accentSoft)} />
          <Tabs.Screen name="recipes" options={tab("Recipes", "chef-hat", p.accentSoft)} />
          <Tabs.Screen name="settings" options={tab("Settings", "cog-outline", p.accentSoft)} />
          {/* reachable from Settings, not shown in the tab bar */}
          <Tabs.Screen name="mealplan" options={{ href: null, title: "Meal plan" }} />
          <Tabs.Screen name="basket"options={{ href: null, title: "Usual items" }} />
          <Tabs.Screen name="receipts" options={{ href: null, title: "Receipts" }} />
          <Tabs.Screen name="sync" options={{ href: null, title: "Sync with Sparkasse" }} />
          <Tabs.Screen name="rules" options={{ href: null, title: "Rules" }} />
          <Tabs.Screen name="subscriptions" options={{ href: null, title: "Subscriptions" }} />
          <Tabs.Screen name="alerts" options={{ href: null, title: "Alerts" }} />
          <Tabs.Screen name="trophies" options={{ href: null, title: "Trophies" }} />
          <Tabs.Screen name="scan" options={{ href: null, title: "Scan a product" }} />
          {/* first-run setup: full screen, no tab bar */}
          <Tabs.Screen name="onboarding" options={{ href: null, title: "Setup", tabBarStyle: { display: "none" } }} />
        </Tabs>
        <BackupOnOpen />
        <AppLockOverlay />
      </ApiProvider>
    </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
