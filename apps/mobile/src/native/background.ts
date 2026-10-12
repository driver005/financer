import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { Api, type ApiConfig } from "@/api/client";
import { CONFIG_KEY, MODE_KEY } from "@/api/keys";
import { getSecret } from "@/api/storage";
import { EmbeddedTransport } from "@/api/transport";
import { anyEnabled } from "@/notifyPlan";
import { EMBEDDED_KEY, EMPTY_EMBEDDED_SETTINGS, embeddedAvailable, startEmbedded, type EmbeddedSettings } from "./embedded";
import { getPrefs, runNotificationChecks } from "./notifications";

export const REFRESH_TASK = "financer-refresh-prices";

/**
 * The API the background task talks to: the on-phone backend (and a way to refresh its prices) or
 * the saved server, or null when the app is not set up. The task runs headlessly, without the
 * app's React tree, so it rebuilds this from secure storage.
 */
async function headlessApi(): Promise<{ api: Api; refreshPrices?: () => Promise<unknown> } | null> {
  if ((await getSecret(MODE_KEY)) === "embedded") {
    if (!embeddedAvailable) return null;
    const raw = await getSecret(EMBEDDED_KEY);
    const settings: EmbeddedSettings = { ...EMPTY_EMBEDDED_SETTINGS, ...(raw ? (JSON.parse(raw) as Partial<EmbeddedSettings>) : {}) };
    const backend = await startEmbedded(settings);
    return { api: new Api(new EmbeddedTransport(backend)), refreshPrices: () => backend.refreshPrices() };
  }
  const raw = await getSecret(CONFIG_KEY);
  return raw ? { api: new Api(JSON.parse(raw) as ApiConfig) } : null;
}

// Defined at import time (the root layout imports this file), because the OS can wake the app
// headlessly and the task must already exist then.
if (Platform.OS !== "web" && !TaskManager.isTaskDefined(REFRESH_TASK)) {
  TaskManager.defineTask(REFRESH_TASK, async () => {
    let failed = false;
    try {
      const ctx = await headlessApi();
      if (!ctx) return BackgroundTask.BackgroundTaskResult.Success; // nothing configured yet
      try {
        await ctx.refreshPrices?.(); // on-phone backend only: a server refreshes its own prices
      } catch {
        failed = true;
      }
      await runNotificationChecks(ctx.api); // never throws
    } catch {
      failed = true;
    }
    return failed ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
  });
}

// Whether the on-phone backend wants its prices refreshed in the background (set while the app runs).
let wantPriceRefresh = false;

/**
 * Register the task with the OS when something needs it (price refresh for the on-phone backend,
 * or any notification kind that is switched on), and unregister it when nothing does. The OS
 * decides when it actually runs: on iOS often overnight, never on a schedule you can rely on, so
 * the app also does the same work whenever it is opened.
 */
export async function refreshBackgroundRegistration(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const wanted = (wantPriceRefresh && embeddedAvailable) || anyEnabled(await getPrefs());
  if (!wanted) {
    if (await TaskManager.isTaskRegisteredAsync(REFRESH_TASK)) await BackgroundTask.unregisterTaskAsync(REFRESH_TASK);
    return false;
  }
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  await BackgroundTask.registerTaskAsync(REFRESH_TASK, { minimumInterval: 12 * 60 });
  return true;
}

/** Ask the OS to refresh prices in the background twice a day or so (on-phone backend only). */
export async function enableBackgroundRefresh(): Promise<boolean> {
  wantPriceRefresh = true;
  return refreshBackgroundRegistration();
}

export async function disableBackgroundRefresh(): Promise<void> {
  wantPriceRefresh = false;
  await refreshBackgroundRegistration();
}
