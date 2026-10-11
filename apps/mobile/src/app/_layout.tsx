import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useColorScheme, type ColorValue } from "react-native";
import { PaperProvider } from "react-native-paper";

import { ApiProvider } from "@/api/config";
import "@/native/background"; // defines the background task at startup
import { themes } from "@/theme";

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
  const theme = useColorScheme() === "dark" ? themes.dark : themes.light;
  return (
    <PaperProvider theme={theme}>
      <ApiProvider>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: theme.colors.primary,
            tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
            tabBarStyle: { backgroundColor: theme.colors.surface },
          }}
        >
          <Tabs.Screen name="index" options={tab("Spending", "swap-vertical")} />
          <Tabs.Screen name="budget" options={tab("Budget", "wallet-outline")} />
          <Tabs.Screen name="prices" options={tab("Prices", "tag-multiple-outline")} />
          <Tabs.Screen name="recipes" options={tab("Recipes", "chef-hat")} />
          <Tabs.Screen name="settings" options={tab("Settings", "cog-outline")} />
          {/* reachable from Settings, not shown in the tab bar */}
          <Tabs.Screen name="basket" options={{ href: null, title: "Usual items" }} />
          <Tabs.Screen name="receipts" options={{ href: null, title: "Receipts" }} />
          <Tabs.Screen name="sync" options={{ href: null, title: "Sync with Sparkasse" }} />
        </Tabs>
      </ApiProvider>
    </PaperProvider>
  );
}
