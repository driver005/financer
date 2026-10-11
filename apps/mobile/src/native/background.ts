import * as BackgroundTask from "expo-background-task";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { getSecret } from "@/api/storage";
import { EMBEDDED_KEY, EMPTY_EMBEDDED_SETTINGS, embeddedAvailable, startEmbedded, type EmbeddedSettings } from "./embedded";

export const REFRESH_TASK = "financer-refresh-prices";

// Defined at import time (the root layout imports this file), because the OS can wake the app
// headlessly and the task must already exist then. Only on devices that have the Rust backend.
if (Platform.OS !== "web" && embeddedAvailable && !TaskManager.isTaskDefined(REFRESH_TASK)) {
  TaskManager.defineTask(REFRESH_TASK, async () => {
    try {
      const raw = await getSecret(EMBEDDED_KEY);
      const settings: EmbeddedSettings = { ...EMPTY_EMBEDDED_SETTINGS, ...(raw ? (JSON.parse(raw) as Partial<EmbeddedSettings>) : {}) };
      const backend = await startEmbedded(settings);
      await backend.refreshPrices();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/**
 * Ask the OS to refresh prices in the background twice a day or so. The OS decides when (on iOS
 * often overnight, never on a schedule you can rely on), so the app also refreshes on open.
 */
export async function enableBackgroundRefresh(): Promise<boolean> {
  if (Platform.OS === "web" || !embeddedAvailable) return false;
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  await BackgroundTask.registerTaskAsync(REFRESH_TASK, { minimumInterval: 12 * 60 });
  return true;
}

export async function disableBackgroundRefresh(): Promise<void> {
  if (Platform.OS === "web" || !embeddedAvailable) return;
  if (await TaskManager.isTaskRegisteredAsync(REFRESH_TASK)) await BackgroundTask.unregisterTaskAsync(REFRESH_TASK);
}
