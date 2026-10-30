import { useEffect } from "react";
import { AppState, Pressable, Text, View } from "react-native";

import type { ModuleHost } from "../host";
import { planDealNotices } from "../logic/dealNotifications";
import { NavProvider, useNav, type Tab } from "./nav";
import { ShopRuntime, useShop } from "./runtime";
import { Banner, Body, Button, Empty, Screen, Title } from "./kit";
import { CategoriesScreen, CategoryEditorScreen } from "./screens/CategoriesScreen";
import { CompareScreen } from "./screens/CompareScreen";
import { DealsScreen } from "./screens/DealsScreen";
import { PlansScreen } from "./screens/PlansScreen";
import { ProductScreen } from "./screens/ProductScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { SettingsScreen, SourcesScreen } from "./screens/SettingsScreen";
import { NewWatchScreen, WatchesScreen } from "./screens/WatchesScreen";
import { WeightsScreen } from "./screens/WeightsScreen";
import { usePalette } from "./theme";

const TABS: { id: Tab; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "deals", label: "Deals" },
  { id: "plans", label: "Plans" },
  { id: "watches", label: "Watching" },
  { id: "more", label: "More" },
];

/**
 * The whole shopping assistant as one component. A host gives it storage, notifications and
 * (optionally) a server or the on-phone backend, and renders it wherever it wants.
 */
export function ShoppingModule({ host }: { host: ModuleHost }) {
  return (
    <ShopRuntime host={host}>
      <NavProvider exit={host.onExit}>
        <Shell />
      </NavProvider>
    </ShopRuntime>
  );
}

function Shell() {
  const shop = useShop();
  const nav = useNav();
  const p = usePalette();
  useDealNotices();

  if (shop.status === "loading") {
    return (
      <Screen>
        <Title>Shopping assistant</Title>
        <Body muted>Starting…</Body>
      </Screen>
    );
  }
  const top = nav.stack[nav.stack.length - 1];
  // Not connected: everything but the settings (reached from More or from the setup screen) waits
  const needsSetup = shop.status !== "ready" && !top && nav.tab !== "more";
  return (
    <View style={{ flex: 1, backgroundColor: p.background }}>
      <View style={{ flex: 1 }}>{needsSetup ? <Setup /> : top ? <Routed route={top} /> : <TabScreen tab={nav.tab} />}</View>
      {top ? null : (
        <View accessibilityRole="tablist" style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: p.border, backgroundColor: p.surface }}>
          {TABS.map((t) => (
            <Pressable key={t.id} accessibilityRole="tab" accessibilityState={{ selected: nav.tab === t.id }} onPress={() => nav.setTab(t.id)} style={{ flex: 1, paddingVertical: 12, alignItems: "center" }}>
              <Text style={{ color: nav.tab === t.id ? p.accent : p.muted, fontSize: 13, fontWeight: nav.tab === t.id ? "700" : "500" }}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function Setup() {
  const shop = useShop();
  const nav = useNav();
  return (
    <Screen>
      <Title onBack={nav.exit}>Shopping assistant</Title>
      {shop.status === "error" ? <Banner tone="bad">{shop.error ?? "Could not connect."}</Banner> : null}
      <Empty
        title="Set it up"
        message="Connect to your server, or let this phone do the searching itself. Nothing is read from the web until you search."
        action={<Button label="Open settings" onPress={() => nav.push({ name: "settings" })} />}
      />
    </Screen>
  );
}

function TabScreen({ tab }: { tab: Tab }) {
  const nav = useNav();
  switch (tab) {
    case "search":
      return <SearchScreen onBack={nav.exit} />;
    case "deals":
      return <DealsScreen />;
    case "plans":
      return <PlansScreen />;
    case "watches":
      return <WatchesScreen />;
    case "more":
      return <SettingsScreen />;
  }
}

function Routed({ route }: { route: ReturnType<typeof useNav>["stack"][number] }) {
  switch (route.name) {
    case "product":
      return <ProductScreen id={route.id} />;
    case "compare":
      return <CompareScreen ids={route.ids} />;
    case "weights":
      return <WeightsScreen category={route.category} />;
    case "categories":
      return <CategoriesScreen />;
    case "category":
      return <CategoryEditorScreen id={route.id} />;
    case "watch":
      return <NewWatchScreen query={route.query} category={route.category} />;
    case "settings":
      return <SettingsScreen />;
    case "sources":
      return <SourcesScreen />;
  }
}

/**
 * Deal messages as local notifications while the app runs: on start, when it comes to the front
 * and once a minute. (With a server that has push set up, the server also pushes them when the
 * app is closed; each message is shown at most once per device either way.)
 */
function useDealNotices() {
  const shop = useShop();
  const { client, settings, host } = shop;
  useEffect(() => {
    if (!client || !settings.dealAlerts) return;
    let alive = true;
    let last = settings.lastNoticeId;
    const check = async () => {
      try {
        const n = await client.notifications(last, 50);
        const plan = planDealNotices(n.items, last);
        for (const notice of plan.notices) await host.notices.present(notice);
        if (alive && plan.lastShownId !== last) {
          last = plan.lastShownId;
          await shop.save({ lastNoticeId: last });
        }
      } catch {
        // offline or the server is away: try again at the next tick
      }
    };
    void check();
    const timer = setInterval(check, 60_000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void check());
    return () => {
      alive = false;
      clearInterval(timer);
      sub.remove();
    };
    // `shop.save` changes with every settings change; the loop only needs to restart for these
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, settings.dealAlerts, host]);
}
