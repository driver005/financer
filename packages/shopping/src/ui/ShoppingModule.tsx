import { useEffect } from "react";
import { AppState } from "react-native";

import { AppShell, Box, Button, EmptyState, Screen, ThemeProvider, TopBar, type NavItem } from "@financer/ui";

import type { ModuleHost } from "../host";
import { planDealNotices } from "../logic/dealNotifications";
import { NavProvider, useNav, type Route, type Tab } from "./nav";
import { ShopRuntime, useShop } from "./runtime";
import { CategoriesScreen, CategoryEditorScreen } from "./screens/CategoriesScreen";
import { CompareScreen } from "./screens/CompareScreen";
import { DealsScreen } from "./screens/DealsScreen";
import { PlansScreen } from "./screens/PlansScreen";
import { ProductScreen } from "./screens/ProductScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { SettingsScreen, SourcesScreen } from "./screens/SettingsScreen";
import { NewWatchScreen, WatchesScreen } from "./screens/WatchesScreen";
import { WeightsScreen } from "./screens/WeightsScreen";

const TABS: NavItem<Tab>[] = [
  { key: "search", label: "Search", icon: "magnify" },
  { key: "deals", label: "Deals", icon: "tag-outline", activeIcon: "tag" },
  { key: "plans", label: "Plans", icon: "sim-outline", activeIcon: "sim" },
  { key: "watches", label: "Watching", icon: "bell-outline", activeIcon: "bell" },
  { key: "more", label: "More", icon: "dots-horizontal" },
];

/**
 * The whole shopping assistant as one component. A host gives it storage, notifications and
 * (optionally) a server or the on-phone backend, and renders it wherever it wants. It follows the
 * system's light or dark setting and the window's size (bottom bar, rail or sidebar).
 */
export function ShoppingModule({ host }: { host: ModuleHost }) {
  return (
    <ThemeProvider>
      <ShopRuntime host={host}>
        <NavProvider exit={host.onExit}>
          <Shell />
        </NavProvider>
      </ShopRuntime>
    </ThemeProvider>
  );
}

function Shell() {
  const shop = useShop();
  const nav = useNav();
  useDealNotices();

  const top = nav.stack[nav.stack.length - 1];
  // Not connected: everything but the settings waits (settings are reached from More or the setup screen)
  const needsSetup = shop.status !== "ready" && !top && nav.tab !== "more";
  // The search tab stays mounted under other screens and tabs, so that going back finds the results,
  // the query and the selection as they were.
  const searchShown = !top && nav.tab === "search";
  const content =
    shop.status === "loading" ? (
      <Starting />
    ) : needsSetup ? (
      <Setup />
    ) : (
      <>
        <Box grow hidden={!searchShown}><SearchScreen onBack={nav.exit} /></Box>
        {top ? <Routed route={top} /> : nav.tab !== "search" ? <TabScreen tab={nav.tab} /> : null}
      </>
    );
  return (
    <AppShell items={TABS} active={nav.tab} onChange={(t) => { nav.reset(); nav.setTab(t); }} title="Shopping assistant">
      {content}
    </AppShell>
  );
}

function Starting() {
  return (
    <Screen header={<TopBar title="Shopping assistant" />}>
      <EmptyState icon="shopping-search-outline" title="Starting…" />
    </Screen>
  );
}

function Setup() {
  const shop = useShop();
  const nav = useNav();
  return (
    <Screen header={<TopBar title="Shopping assistant" onBack={nav.exit} />}>
      <EmptyState
        icon="cog-outline"
        title="Set it up"
        message={shop.status === "error" ? (shop.error ?? "Could not connect.") : "Connect to your server, or let this phone do the searching itself. Nothing is read from the web until you search."}
        action={<Button label="Open settings" onPress={() => nav.push({ name: "settings" })} />}
      />
    </Screen>
  );
}

function TabScreen({ tab }: { tab: Tab }) {
  switch (tab) {
    case "search":
      return null;
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

function Routed({ route }: { route: Route }) {
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

