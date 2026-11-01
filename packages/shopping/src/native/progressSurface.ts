// Shows the index run's progress as a notification.
//
// Android + Notifee: a real determinate progress bar, and a foreground service so the run keeps
// going when the person leaves the app. Everything else (iOS, Expo Go, builds without Notifee):
// a sticky notification whose text carries a bar made of blocks, re-posted under one id. Neither
// has run on a device yet (see docs/SHOP.md).

import { Platform } from "react-native";

import { CHANNEL_ID, DONE_ID, NOTIFICATION_ID, NotifeeSurface, STOP_ACTION, registerIndexService as registerOn, type NotifeeLike } from "../logic/notifeeSurface";
import type { ProgressModel, ProgressSurface } from "../logic/progress";

const EXPO_CATEGORY = "shop-index";

let notifeeCache: NotifeeLike | null | undefined;

function notifee(): NotifeeLike | null {
  if (notifeeCache !== undefined) return notifeeCache;
  if (Platform.OS !== "android") return (notifeeCache = null);
  try {
    // Optional: Metro treats a require inside try/catch as an optional dependency.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@notifee/react-native");
    notifeeCache = (mod.default ?? mod) as NotifeeLike;
  } catch {
    notifeeCache = null;
  }
  return notifeeCache;
}

/** True when this build can show a real progress bar. */
export function hasNativeProgress(): boolean {
  return notifee() !== null;
}

/**
 * Call once at app start (outside any component). On Android with Notifee it registers the foreground
 * service that keeps an index run alive and the Stop button of its notification.
 */
export function registerIndexService(): void {
  const n = notifee();
  if (n) registerOn(n);
}

type ExpoNotifications = typeof import("expo-notifications");

let expoLoading: Promise<ExpoNotifications | null> | null = null;

function expo(): Promise<ExpoNotifications | null> {
  if (Platform.OS === "web") return Promise.resolve(null);
  expoLoading ??= (async () => {
    try {
      const n = await import("expo-notifications");
      if (Platform.OS === "android") {
        await n.setNotificationChannelAsync(CHANNEL_ID, { name: "Search index progress", importance: n.AndroidImportance.LOW });
      }
      return n;
    } catch {
      return null;
    }
  })();
  return expoLoading;
}

class ExpoSurface implements ProgressSurface {
  private listening: { remove(): void } | null = null;
  constructor(private onStop?: () => void) {}

  async show(m: ProgressModel): Promise<void> {
    const n = await expo();
    if (!n) return;
    if (this.onStop && !this.listening) {
      // a Stop button under the notification (iOS and Android through expo-notifications)
      await n.setNotificationCategoryAsync(EXPO_CATEGORY, [{ identifier: STOP_ACTION, buttonTitle: "Stop", options: { opensAppToForeground: false } }]).catch(() => {});
      this.listening = n.addNotificationResponseReceivedListener((r) => {
        if (r.actionIdentifier === STOP_ACTION) this.onStop?.();
      });
    }
    await n.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: { title: m.title, body: `${m.bar}\n${m.body}`, sticky: true, autoDismiss: false, data: { kind: "shop-index" }, ...(this.onStop ? { categoryIdentifier: EXPO_CATEGORY } : {}) },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL_ID } : null,
    });
  }

  async finish(m: ProgressModel): Promise<void> {
    const n = await expo();
    if (!n) return;
    this.listening?.remove();
    this.listening = null;
    await n.dismissNotificationAsync(NOTIFICATION_ID).catch(() => {});
    await n.scheduleNotificationAsync({
      identifier: DONE_ID,
      content: { title: m.title, body: m.body, data: { kind: "shop-index" } },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL_ID } : null,
    });
  }
}

/** The best surface this build has. */
export function createProgressSurface(onStop?: () => void): ProgressSurface {
  const n = notifee();
  return n ? new NotifeeSurface(n, onStop) : new ExpoSurface(onStop);
}

/** Ask for the permission the notifications need (Android 13+, iOS). */
export async function requestProgressPermission(): Promise<boolean> {
  const n = notifee();
  if (n) {
    try {
      await n.requestPermission();
    } catch {
      // fall through to the Expo check
    }
  }
  const e = await expo();
  if (!e) return false;
  const current = await e.getPermissionsAsync();
  if (current.granted) return true;
  return (await e.requestPermissionsAsync()).granted;
}
