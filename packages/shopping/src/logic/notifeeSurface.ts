// The Android progress notification (Notifee): a real determinate bar, a Stop button, and a
// foreground service so an index run keeps going when the person leaves the app. This file has no
// React Native import so that what it shows can be tested; `native/progressSurface.ts` loads Notifee
// and hands it in. It has not run on a device yet (see docs/SHOP.md).

import type { ProgressModel, ProgressSurface } from "./progress";

export const NOTIFICATION_ID = "financer.shop.index";
export const CHANNEL_ID = "shop-index";
export const DONE_ID = "financer.shop.index.done";
export const STOP_ACTION = "stop";

/** Notifee's `EventType.ACTION_PRESS`. */
export const ACTION_PRESS = 2;
const IMPORTANCE_LOW = 2;
const FOREGROUND_SERVICE_TYPE_DATA_SYNC = 1;

export type NotifeeEvent = { type: number; detail: { pressAction?: { id: string } } };

/** The part of Notifee's API used here; the package is optional, so no types are imported. */
export type NotifeeLike = {
  createChannel(c: { id: string; name: string; importance: number }): Promise<string>;
  displayNotification(n: { id: string; title: string; body: string; android: Record<string, unknown>; ios?: Record<string, unknown> }): Promise<string>;
  registerForegroundService(runner: () => Promise<void>): void;
  stopForegroundService(): Promise<void>;
  cancelNotification(id: string): Promise<void>;
  requestPermission(): Promise<unknown>;
  onForegroundEvent(observer: (e: NotifeeEvent) => void): () => void;
  onBackgroundEvent(observer: (e: NotifeeEvent) => Promise<void>): void;
};

export function isStopPress(e: NotifeeEvent): boolean {
  return e.type === ACTION_PRESS && e.detail.pressAction?.id === STOP_ACTION;
}

let stopService: (() => void) | null = null;
let registered = false;
/** What the Stop button does for the run that is showing. */
let activeStop: (() => void) | null = null;

/**
 * Android keeps an app process alive only while it runs a foreground service. Call this once at
 * app start (outside any component): the service's work is "wait until the index run ends". It
 * also listens for the Stop button, whether the app is in front or not.
 */
export function registerIndexService(n: NotifeeLike): void {
  if (registered) return;
  registered = true;
  n.registerForegroundService(
    () =>
      new Promise<void>((resolve) => {
        stopService = resolve;
      }),
  );
  n.onForegroundEvent((e) => {
    if (isStopPress(e)) activeStop?.();
  });
  n.onBackgroundEvent(async (e) => {
    if (isStopPress(e)) activeStop?.();
  });
}

export function isServiceRegistered(): boolean {
  return registered;
}

export class NotifeeSurface implements ProgressSurface {
  private channel: Promise<string> | null = null;
  constructor(
    private n: NotifeeLike,
    /** Called when the person presses Stop on the notification. */
    private onStop?: () => void,
  ) {
    activeStop = onStop ?? null;
  }

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
        actions: this.onStop ? [{ title: "Stop", pressAction: { id: STOP_ACTION } }] : [],
      },
    });
  }

  async finish(m: ProgressModel): Promise<void> {
    const channelId = await this.ensureChannel();
    activeStop = null;
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
