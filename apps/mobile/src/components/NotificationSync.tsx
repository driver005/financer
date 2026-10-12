import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import { useApi } from "@/api/config";
import { runNotificationChecks } from "@/native/notifications";

const MIN_GAP_MS = 5 * 60 * 1000;
let lastRun = 0;

/**
 * Renders nothing. When the app opens (and each time it returns to the foreground, at most every
 * five minutes) it refreshes the scheduled notifications and checks for price drops. The same
 * work runs in the background task, but the OS decides if and when that happens.
 */
export function NotificationSync() {
  const { api } = useApi();

  useEffect(() => {
    if (!api || Platform.OS === "web") return;
    const run = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastRun < MIN_GAP_MS) return;
      lastRun = now;
      void runNotificationChecks(api);
    };
    run(true); // a different backend (or first load) always checks
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") run(false);
    });
    return () => sub.remove();
  }, [api]);

  return null;
}
