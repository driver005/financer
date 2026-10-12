import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { type ColorValue } from "react-native";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ApiProvider } from "@/api/config";
import "@/native/background"; // defines the background task at startup
import "@/global.css";
import { usePalette } from "@/theme";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

function tab(title: string, icon: IconName) {
  return {
    title,
    tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
      <MaterialCommunityIcons name={icon} color={color as string} size={size} />
    ),
  };
}

export default function RootLayout() {
  const p = usePalette();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider config={{ toast: { defaultProps: { placement: "bottom" } } }}>
      <ApiProvider>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: p.accent,
            tabBarInactiveTintColor: p.muted,
            tabBarStyle: { backgroundColor: p.surface, borderTopWidth: 2, borderTopColor: p.border, height: 64, paddingTop: 6 },
            tabBarLabelStyle: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3, textTransform: "uppercase" },
          }}
        >
          <Tabs.Screen name="index" options={tab("Today", "home-variant")} />
          <Tabs.Screen name="spending" options={tab("Spending", "swap-vertical")} />
          <Tabs.Screen name="budget" options={tab("Budget", "wallet-outline")} />
          <Tabs.Screen name="prices" options={tab("Prices", "tag-multiple-outline")} />
          <Tabs.Screen name="recipes" options={tab("Recipes", "chef-hat")} />
          <Tabs.Screen name="settings" options={tab("Settings", "cog-outline")} />
          {/* reachable from Settings, not shown in the tab bar */}
          <Tabs.Screen name="basket" options={{ href: null, title: "Usual items" }} />
          <Tabs.Screen name="receipts" options={{ href: null, title: "Receipts" }} />
          <Tabs.Screen name="sync" options={{ href: null, title: "Sync with Sparkasse" }} />
          <Tabs.Screen name="rules" options={{ href: null, title: "Rules" }} />
          <Tabs.Screen name="subscriptions" options={{ href: null, title: "Subscriptions" }} />
          <Tabs.Screen name="alerts" options={{ href: null, title: "Alerts" }} />
        </Tabs>
      </ApiProvider>
    </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
