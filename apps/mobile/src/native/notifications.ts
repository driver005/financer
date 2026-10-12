import { Platform } from "react-native";

import type { Api } from "@/api/client";
import { getSecret, setSecret } from "@/api/storage";
import {
  DEFAULT_PREFS,
  EVENING_ID_PREFIX,
  PAYDAY_ID_PREFIX,
  eveningPlan,
  findPriceDrops,
  parsePrefs,
  parsePriceMemory,
  paydayPlan,
  priceDropMessage,
  type NotifyKind,
  type NotifyPrefs,
  type Planned,
} from "@/notifyPlan";
import { localIsoDate } from "@/period";

/**
 * Local notifications: the phone itself schedules them, no server and no push service is involved.
 * What to say and when is decided by `notifyPlan.ts`; this file talks to expo-notifications.
 *
 * Everything here is a no-op on the web and in builds without the native module (the module is
 * loaded on first use and a failed load just means "not supported"). Nothing is logged: the texts
 * contain amounts, and the stored state holds prices only.
 */

const PREFS_KEY = "financer.notify.prefs";
const MEMORY_KEY = "financer.notify.price-memory";
const CHANNEL = "financer";

type Notifications = typeof import("expo-notifications");

let loading: Promise<Notifications | null> | null = null;

/** The expo-notifications module, set up once (foreground display and the Android channel), or null. */
function load(): Promise<Notifications | null> {
  if (Platform.OS === "web") return Promise.resolve(null);
  loading ??= (async () => {
    try {
      const n = await import("expo-notifications");
      n.setNotificationHandler({
        handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
      });
      if (Platform.OS === "android") {
        // Android 13+ only asks for permission once a channel exists.
        await n.setNotificationChannelAsync(CHANNEL, {
          name: "Reminders and price alerts",
          importance: n.AndroidImportance.DEFAULT,
        });
      }
      return n;
    } catch {
      return null; // no native module in this build
    }
  })();
  return loading;
}

/** Whether this build can show notifications at all (false on the web). */
export async function notificationsSupported(): Promise<boolean> {
  return (await load()) !== null;
}

export type PermissionState = "granted" | "denied" | "undetermined" | "unsupported";

export async function permissionState(): Promise<PermissionState> {
  const n = await load();
  if (!n) return "unsupported";
  try {
    const p = await n.getPermissionsAsync();
    if (p.granted) return "granted";
    return String(p.status) === "undetermined" && p.canAskAgain ? "undetermined" : "denied";
  } catch {
    return "unsupported";
  }
}

/** Shows the system permission prompt (only possible while the state is "undetermined"). */
export async function requestPermission(): Promise<PermissionState> {
  const n = await load();
  if (!n) return "unsupported";
  try {
    await n.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: false } });
  } catch {
    // fall through to the state check
  }
  return permissionState();
}

export async function getPrefs(): Promise<NotifyPrefs> {
  try {
    return parsePrefs(await getSecret(PREFS_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

async function savePrefs(prefs: NotifyPrefs): Promise<void> {
  await setSecret(PREFS_KEY, JSON.stringify(prefs));
}

/**
 * Turn one kind on or off. Turning on asks for the system permission when it was never asked; if
 * the answer is no (or notifications are unsupported) the switch stays off and the returned
 * `permission` says why. Callers follow up with `runNotificationChecks` so the change takes effect.
 */
export async function setKindEnabled(kind: NotifyKind, enabled: boolean): Promise<{ prefs: NotifyPrefs; permission: PermissionState }> {
  let permission = await permissionState();
  const current = await getPrefs();
  if (enabled) {
    if (permission === "undetermined") permission = await requestPermission();
    if (permission !== "granted") return { prefs: current, permission };
  }
  const prefs = { ...current, [kind]: enabled };
  await savePrefs(prefs);
  return { prefs, permission };
}

export type NotifyApi = Pick<Api, "safeToSpend" | "basket" | "prices">;

let running: Promise<void> | null = null;

/**
 * Bring the scheduled notifications in line with the preferences and the current numbers, and look
 * for price drops. Called when the app opens or returns to the foreground and from the background
 * task. Safe to call at any time: it does nothing without permission or when everything is off, a
 * failed request keeps the notifications that are already scheduled, and overlapping calls share
 * one run.
 */
export function runNotificationChecks(api: NotifyApi, now: Date = new Date()): Promise<void> {
  running ??= check(api, now)
    .catch(() => {})
    .finally(() => {
      running = null;
    });
  return running;
}

async function check(api: NotifyApi, now: Date): Promise<void> {
  const n = await load();
  if (!n) return;
  const prefs = await getPrefs();
  const granted = (await permissionState()) === "granted";

  const cancelWithPrefix = async (prefix: string) => {
    for (const s of await n.getAllScheduledNotificationsAsync()) {
      if (s.identifier.startsWith(prefix)) await n.cancelScheduledNotificationAsync(s.identifier);
    }
  };
  if (!granted || !prefs.evening) await cancelWithPrefix(EVENING_ID_PREFIX);
  if (!granted || !prefs.payday) await cancelWithPrefix(PAYDAY_ID_PREFIX);
  if (!granted) return;

  const today = localIsoDate(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const schedule = async (p: Planned) => {
    const [y, m, d] = p.date.split("-").map(Number);
    const date = new Date(y, m - 1, d, p.hour, p.minute);
    if (date.getTime() <= Date.now()) return;
    await n.scheduleNotificationAsync({
      identifier: p.id,
      content: { title: p.title, body: p.body },
      trigger: { type: n.SchedulableTriggerInputTypes.DATE, date, channelId: CHANNEL },
    });
  };

  if (prefs.evening || prefs.payday) {
    try {
      const safe = await api.safeToSpend(today);
      if (prefs.evening) {
        await cancelWithPrefix(EVENING_ID_PREFIX);
        for (const p of eveningPlan(safe, nowMinutes)) await schedule(p);
      }
      if (prefs.payday) {
        await cancelWithPrefix(PAYDAY_ID_PREFIX);
        for (const p of paydayPlan(today, safe.payday, nowMinutes)) await schedule(p);
      }
    } catch {
      // no answer (offline, server down): keep what is already scheduled
    }
  }

  if (prefs.priceDrop) {
    try {
      await checkPriceDrops(n, api);
    } catch {
      // try again at the next check
    }
  }
}

async function checkPriceDrops(n: Notifications, api: NotifyApi): Promise<void> {
  const basket = await api.basket();
  // "starter" is a generic list used until the user's habits are known, not what they buy.
  if (basket.source === "starter") return;
  const prices = await api.prices();
  const before = parsePriceMemory(await getSecret(MEMORY_KEY));
  const { drops, memory } = findPriceDrops(
    basket.items.map((i) => ({ item: i.item, name: i.name })),
    prices,
    before,
  );
  // Remember first, announce second: if anything fails in between, a drop is missed rather than
  // announced twice.
  await setSecret(MEMORY_KEY, JSON.stringify(memory));
  const message = priceDropMessage(drops);
  if (!message) return;
  await n.scheduleNotificationAsync({
    content: { title: message.title, body: message.body },
    trigger: { channelId: CHANNEL },
  });
}

/** The next scheduled evening message and payday reminder, as ISO dates (for the settings card). */
export async function scheduledSummary(): Promise<{ evening: string | null; payday: string | null }> {
  const n = await load();
  const out = { evening: null as string | null, payday: null as string | null };
  if (!n) return out;
  try {
    const earliest = (prefix: string, all: { identifier: string }[]) =>
      all
        .filter((s) => s.identifier.startsWith(prefix))
        .map((s) => s.identifier.slice(prefix.length))
        .sort()[0] ?? null;
    const all = await n.getAllScheduledNotificationsAsync();
    out.evening = earliest(EVENING_ID_PREFIX, all);
    out.payday = earliest(PAYDAY_ID_PREFIX, all);
  } catch {
    // unknown
  }
  return out;
}
