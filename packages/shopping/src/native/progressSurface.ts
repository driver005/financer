// Shows the index run's progress as a notification.
//
// Android + Notifee: a real determinate progress bar, and a foreground service so the run keeps
// going when the person leaves the app. Everything else (iOS, Expo Go, builds without Notifee):
// a sticky notification whose text carries a bar made of blocks, re-posted under one id. Neither
// has run on a device yet (see docs/SHOP.md).

import { Platform } from "react-native";

import type { ProgressModel, ProgressSurface } from "../logic/progress";

const NOTIFICATION_ID = "financer.shop.index";
const CHANNEL_ID = "shop-index";
const DONE_ID = "financer.shop.index.done";

/** The part of Notifee's API used here; the package is optional, so no types are imported. */
type NotifeeLike = {
  createChannel(c: { id: string; name: string; importance: number }): Promise<string>;
  displayNotification(n: { id: string; title: string; body: string; android: Record<string, unknown>; ios?: Record<string, unknown> }): Promise<string>;
  registerForegroundService(runner: () => Promise<void>): void;
  stopForegroundService(): Promise<void>;
  cancelNotification(id: string): Promise<void>;
  requestPermission(): Promise<unknown>;
};

const IMPORTANCE_LOW = 2;
const FOREGROUND_SERVICE_TYPE_DATA_SYNC = 1;

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

let stopService: (() => void) | null = null;
let registered = false;

/**
 * Android keeps an app process alive only while it runs a foreground service. Call this once at
 * app start (outside any component): the service's work is "wait until the index run ends".
 */
export function registerIndexService(): void {
  const n = notifee();
  if (!n || registered) return;
  registered = true;
  n.registerForegroundService(
    () =>
      new Promise<void>((resolve) => {
        stopService = resolve;
      }),
  );
}

class NotifeeSurface implements ProgressSurface {
  private channel: Promise<string> | null = null;
  constructor(private n: NotifeeLike) {}

  private ensureChannel(): Promise<string> {
    this.channel ??= this.n.createChannel({ id: CHANNEL_ID, name: "Search index progress", importance: IMPORTANCE_LOW });
    return this.channel;
  }

  async show(m: ProgressModel): Promise<void> {
    const channelId = await this.ensureChannel();
    await this.n.displayNotification({
      id: NOTIFICATION_ID,
      title: m.title,
      body: m.body,
      android: {
        channelId,
        ongoing: true,
        onlyAlertOnce: true,
        asForegroundService: registered,
        foregroundServiceTypes: [FOREGROUND_SERVICE_TYPE_DATA_SYNC],
        progress: { max: 100, current: m.percent, indeterminate: m.indeterminate },
        pressAction: { id: "default" },
      },
    });
  }

  async finish(m: ProgressModel): Promise<void> {
    const channelId = await this.ensureChannel();
    stopService?.();
    stopService = null;
    try {
      await this.n.stopForegroundService();
    } catch {
      // no service was running
    }
    await this.n.cancelNotification(NOTIFICATION_ID);
    await this.n.displayNotification({
      id: DONE_ID,
      title: m.title,
      body: m.body,
      android: { channelId, ongoing: false, autoCancel: true, pressAction: { id: "default" } },
    });
  }
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
  async show(m: ProgressModel): Promise<void> {
    const n = await expo();
    if (!n) return;
    await n.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: { title: m.title, body: `${m.bar}\n${m.body}`, sticky: true, autoDismiss: false, data: { kind: "shop-index" } },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL_ID } : null,
    });
  }

  async finish(m: ProgressModel): Promise<void> {
    const n = await expo();
    if (!n) return;
    await n.dismissNotificationAsync(NOTIFICATION_ID).catch(() => {});
    await n.scheduleNotificationAsync({
      identifier: DONE_ID,
      content: { title: m.title, body: m.body, data: { kind: "shop-index" } },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL_ID } : null,
    });
  }
}

/** The best surface this build has. */
export function createProgressSurface(): ProgressSurface {
  const n = notifee();
  return n ? new NotifeeSurface(n) : new ExpoSurface();
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
