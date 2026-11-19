import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text as RNText, useColorScheme, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Montserrat_400Regular, Montserrat_600SemiBold, Montserrat_700Bold } from "@expo-google-fonts/montserrat";
import { PlusJakartaSans_400Regular, PlusJakartaSans_600SemiBold } from "@expo-google-fonts/plus-jakarta-sans";
import { Urbanist_500Medium, Urbanist_600SemiBold } from "@expo-google-fonts/urbanist";
import { FinanceUIProvider, darkTheme, lightTheme } from "@finance/ui";
import { Tabs, usePathname, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { IconButton, type IconName } from "../ui/primitives";
import { LockGate } from "../components/LockGate";
import { tokens, useTheme } from "../ui/theme";

const TABS: { route: string; label: string; icon: IconName }[] = [
  { route: "/home", label: "Overview", icon: "home" },
  { route: "/contracts", label: "Contracts", icon: "file-document-outline" },
  { route: "/insights", label: "Insights", icon: "chart-bar" },
  { route: "/insurance", label: "Insurance", icon: "shield-outline" },
  { route: "/savings", label: "Savings Booster", icon: "piggy-bank" },
];

function BottomBar() {
  const router = useRouter();
  const path = usePathname();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  if (path === "/showcase" || path === "/connect") return null;
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
              <View style={[styles.iconWrap, active && { backgroundColor: colors.accentSoft }]}>
                <MaterialCommunityIcons name={tab.icon} size={20} color={active ? colors.accent : colors.subtle} />
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
  outer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 8 },
  bar: {
    flexDirection: "row", borderWidth: 1, borderRadius: tokens.radius.card, paddingVertical: 8,
    shadowColor: "#3C318F", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.16, shadowRadius: 16, elevation: 6,
  },
  tab: { flex: 1, minHeight: 52, alignItems: "center", justifyContent: "center", gap: 3 },
  iconWrap: { width: 40, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  tabLabel: { fontSize: 10, fontFamily: tokens.sans, fontWeight: "600" },
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
    Montserrat: Montserrat_600SemiBold,
    "Montserrat Regular": Montserrat_400Regular,
    "Montserrat Bold": Montserrat_700Bold,
    Urbanist: Urbanist_600SemiBold,
    "Urbanist Medium": Urbanist_500Medium,
    "Plus Jakarta Sans": PlusJakartaSans_400Regular,
    "Plus Jakarta Sans SemiBold": PlusJakartaSans_600SemiBold,
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
        <Tabs.Screen name="finance" options={{ title: "Finance suite" }} />
        <Tabs.Screen name="upstream" options={{ title: "Upstream features" }} />
        <Tabs.Screen name="gaps" options={{ title: "Parity gaps" }} />
      </Tabs>
      </LockGate>
      <View style={{ position: "absolute", top: 8, right: tokens.md, zIndex: 10 }}>
        <IconButton icon="cog-outline" label="Settings" onPress={() => router.push("/settings")} />
      </View>
    </View>
    </FinanceUIProvider>
  );
}
