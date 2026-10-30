import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { useMemo } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ShoppingModule, createHost } from "../../../packages/shopping/src";
import { ShopBackend } from "../modules/financer-embedded";

// Messages are shown while the app is in front too: a deal found by a search the person just ran.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export default function App() {
  const host = useMemo(() => createHost({ ShopBackend }), []);
  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <ShoppingModule host={host} />
    </SafeAreaProvider>
  );
}
