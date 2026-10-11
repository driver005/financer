import { Tabs } from "expo-router";

import { ApiProvider } from "@/api/config";
import { useColors } from "@/components/ui";

export default function RootLayout() {
  const c = useColors();
  return (
    <ApiProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.accent,
          tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Transactions" }} />
        <Tabs.Screen name="budget" options={{ title: "Budget" }} />
        <Tabs.Screen name="settings" options={{ title: "Settings" }} />
      </Tabs>
    </ApiProvider>
  );
}
