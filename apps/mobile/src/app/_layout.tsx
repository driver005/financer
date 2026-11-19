import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text as RNText, useColorScheme, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import {
  NunitoSans_400Regular, NunitoSans_600SemiBold, NunitoSans_700Bold, NunitoSans_800ExtraBold,
} from "@expo-google-fonts/nunito-sans";
import { FinanceUIProvider, darkTheme, lightTheme } from "@finance/ui";
import { Tabs, usePathname, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { type IconName } from "../ui/primitives";
import { LockGate } from "../components/LockGate";
import { tokens, useTheme } from "../ui/theme";

const TABS: { route: string; label: string; icon: IconName }[] = [
  { route: "/home", label: "Overview", icon: "home" },
  { route: "/prices", label: "Prices", icon: "tag-search" },
  { route: "/contracts", label: "Contracts", icon: "file-document-outline" },
  { route: "/insights", label: "Insights", icon: "chart-bar" },
  { route: "/hub", label: "More", icon: "view-grid" },
];

function BottomBar() {
  const router = useRouter();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (path === "/showcase" || path === "/connect" || path.startsWith("/price-detail")) return null;
  return (
    <View style={[styles.outer, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {TABS.map((tab) => {
          const active = path === tab.route || (tab.route !== "/" && path.startsWith(`${tab.route}/`));
          return (
            <Pressable
              key={tab.route}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
              onPress={() => router.push(tab.route as never)}
              style={styles.tab}
            >
              <View style={[styles.iconWrap, active && { backgroundColor: "#D7FFB8" }]}>
                <MaterialCommunityIcons name={tab.icon} size={22} color={active ? colors.accent : colors.subtle} />
              </View>
              <RNText style={[styles.tabLabel, { color: active ? colors.accent : colors.subtle }]}>{tab.label}</RNText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingTop: 6 },
  bar: {
    flexDirection: "row", borderWidth: 2, borderColor: "#E5E5E5", borderRadius: tokens.radius.card, paddingVertical: 8,
    shadowColor: "#000000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 4,
  },
  tab: { flex: 1, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 4 },
  iconWrap: { width: 46, height: 34, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  tabLabel: { fontSize: 11, fontFamily: tokens.serif, fontWeight: "800" },
});

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const open = (url: string | null) => {
      if (!url || !url.startsWith("pantry://")) return;
      if (!/quickadd/i.test(url) || pathname === "/quickadd") return;
      router.push("/quickadd");
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener("url", ({ url }) => open(url));
    return () => subscription.remove();
  }, [router, pathname]);
  const scheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    "Nunito Sans": NunitoSans_400Regular,
    "Nunito Sans SemiBold": NunitoSans_600SemiBold,
    "Nunito Sans Bold": NunitoSans_700Bold,
    "Nunito Sans ExtraBold": NunitoSans_800ExtraBold,
  });
  if (!fontsLoaded) return null;
  return (
    <FinanceUIProvider theme={scheme === "dark" ? darkTheme : lightTheme}>
    <View style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <LockGate>
      <Tabs screenOptions={{ headerShown: false }} tabBar={() => <BottomBar />}>
        <Tabs.Screen name="index" options={{ title: "Recipes" }} />
        <Tabs.Screen name="favorites" options={{ title: "Saved" }} />
        <Tabs.Screen name="list" options={{ title: "List" }} />
        <Tabs.Screen name="shops" options={{ title: "Shops" }} />
        <Tabs.Screen name="money" options={{ title: "Money" }} />
        <Tabs.Screen name="recipe" options={{ title: "Recipe" }} />
        <Tabs.Screen name="settings" options={{ title: "Settings" }} />
        <Tabs.Screen name="item" options={{ title: "Item prices" }} />
        <Tabs.Screen name="optimize" options={{ title: "Best prices" }} />
        <Tabs.Screen name="quickadd" options={{ title: "Add transaction" }} />
        <Tabs.Screen name="export" options={{ title: "Export CSV" }} />
        <Tabs.Screen name="moneytools" options={{ title: "Money tools" }} />
        <Tabs.Screen name="reports" options={{ title: "Reports" }} />
        <Tabs.Screen name="pc" options={{ title: "PC editor" }} />
        <Tabs.Screen name="ask" options={{ title: "Ask your money" }} />
        <Tabs.Screen name="showcase" options={{ title: "UI kit" }} />
        <Tabs.Screen name="home" options={{ title: "Home" }} />
        <Tabs.Screen name="recipes" options={{ title: "Recipes" }} />
        <Tabs.Screen name="transactions" options={{ title: "Transactions" }} />
        <Tabs.Screen name="goals" options={{ title: "Goals" }} />
        <Tabs.Screen name="hub" options={{ title: "All apps" }} />
        <Tabs.Screen name="budgets" options={{ title: "Budgets" }} />
        <Tabs.Screen name="projects" options={{ title: "Projects" }} />
        <Tabs.Screen name="paycheck" options={{ title: "Paycheck" }} />
        <Tabs.Screen name="accounts" options={{ title: "Accounts" }} />
        <Tabs.Screen name="obligations" options={{ title: "Obligations" }} />
        <Tabs.Screen name="holdings" options={{ title: "Assets" }} />
        <Tabs.Screen name="contracts" options={{ title: "Contracts" }} />
        <Tabs.Screen name="categorised" options={{ title: "Automatically categorised" }} />
        <Tabs.Screen name="connect" options={{ title: "Connect accounts" }} />
        <Tabs.Screen name="insights" options={{ title: "Insights" }} />
        <Tabs.Screen name="insurance" options={{ title: "Insurance" }} />
        <Tabs.Screen name="savings" options={{ title: "Savings Booster" }} />
        <Tabs.Screen name="prices" options={{ title: "Price comparison" }} />
        <Tabs.Screen name="price-detail" options={{ title: "Price details" }} />
        <Tabs.Screen name="flows" options={{ title: "Money flows" }} />
        <Tabs.Screen name="finance" options={{ title: "Finance suite" }} />
        <Tabs.Screen name="upstream" options={{ title: "Upstream features" }} />
        <Tabs.Screen name="gaps" options={{ title: "Parity gaps" }} />
      </Tabs>
      </LockGate>
    </View>
    </FinanceUIProvider>
  );
}
