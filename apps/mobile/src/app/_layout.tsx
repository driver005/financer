import { Tabs } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ApiProvider } from "@/api/config";
import { AppLockOverlay } from "@/components/AppLockOverlay";
import { AppTabBar } from "@/components/AppTabBar";
import { BackupOnOpen } from "@/components/BackupOnOpen";
import "@/native/background"; // defines the background task at startup
import { NotificationSync } from "@/components/NotificationSync";
import { OnboardingGate } from "@/components/OnboardingGate";
import "@/global.css";

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HeroUINativeProvider config={{ toast: { defaultProps: { placement: "bottom" } } }}>
      <ApiProvider>
        {/* dark icons on the light theme, light icons on the dark one (the default left white ones on white) */}
        <StatusBar style="auto" />
        <NotificationSync />
        <OnboardingGate />
        <Tabs screenOptions={{ headerShown: false }} tabBar={() => <AppTabBar />}>
          {/* the bottom bar (AppTabBar) lists four tabs; every route below stays reachable by link */}
          <Tabs.Screen name="index" options={{ title: "Today" }} />
          <Tabs.Screen name="spending" options={{ title: "Spending" }} />
          <Tabs.Screen name="budget" options={{ title: "Budget" }} />
          <Tabs.Screen name="prices" options={{ title: "Prices" }} />
          <Tabs.Screen name="recipes" options={{ title: "Recipes" }} />
          <Tabs.Screen name="settings" options={{ title: "Settings" }} />
          <Tabs.Screen name="mealplan" options={{ title: "Meal plan" }} />
          <Tabs.Screen name="basket" options={{ title: "Usual items" }} />
          <Tabs.Screen name="receipts" options={{ title: "Receipts" }} />
          <Tabs.Screen name="receipt-sources" options={{ title: "Receipt sources" }} />
          <Tabs.Screen name="server-config" options={{ title: "Server settings" }} />
          <Tabs.Screen name="sync" options={{ title: "Sync with Sparkasse" }} />
          <Tabs.Screen name="rules" options={{ title: "Rules" }} />
          <Tabs.Screen name="subscriptions" options={{ title: "Subscriptions" }} />
          <Tabs.Screen name="alerts" options={{ title: "Alerts" }} />
          <Tabs.Screen name="trophies" options={{ title: "Trophies" }} />
          <Tabs.Screen name="scan" options={{ title: "Scan a product" }} />
          <Tabs.Screen name="stores" options={{ title: "Stores" }} />
          {/* the shopping assistant, a second app of this project (see modules.ts): draws its own chrome */}
          <Tabs.Screen name="shop" options={{ title: "Shopping assistant" }} />
          {/* first-run setup: full screen, no tab bar */}
          <Tabs.Screen name="onboarding" options={{ title: "Setup" }} />
        </Tabs>
        <BackupOnOpen />
        <AppLockOverlay />
      </ApiProvider>
    </HeroUINativeProvider>
    </GestureHandlerRootView>
  );
}
