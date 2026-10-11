import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useColorScheme, type ColorValue } from "react-native";
import { PaperProvider } from "react-native-paper";

import { ApiProvider } from "@/api/config";
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
            tabBarStyle: { backgroundColor: theme.colors.surface },
          }}
        >
          <Tabs.Screen name="index" options={tab("Transactions", "swap-vertical")} />
          <Tabs.Screen name="budget" options={tab("Budget", "wallet-outline")} />
          <Tabs.Screen name="settings" options={tab("Settings", "cog-outline")} />
        </Tabs>
      </ApiProvider>
    </PaperProvider>
  );
}
