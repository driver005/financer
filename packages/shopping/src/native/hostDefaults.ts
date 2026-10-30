// The default `ModuleHost` for an Expo app: files and the keychain for storage, expo-notifications
// for messages, and the Rust backend (when the build has it) for "on this phone".

import Constants from "expo-constants";
import { File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { EmbeddedStart, KeyValue, ModuleHost } from "../host";
import type { ShopBackendHandle, ShopServerConfig } from "../api/transport";
import type { LocalNotice } from "../logic/dealNotifications";
import { createProgressSurface, requestProgressPermission } from "./progressSurface";

const web = Platform.OS === "web";

/** Small non-secret settings in one JSON file in the app's document directory. */
export function fileStorage(name = "financer-shop-settings.json"): KeyValue {
  const read = async (): Promise<Record<string, string>> => {
    try {
      if (web) return JSON.parse(globalThis.localStorage?.getItem(name) ?? "{}");
      const file = new File(Paths.document, name);
      return file.exists ? JSON.parse(await file.text()) : {};
    } catch {
      return {};
    }
  };
  const write = async (all: Record<string, string>) => {
    const text = JSON.stringify(all);
    if (web) return void globalThis.localStorage?.setItem(name, text);
    const file = new File(Paths.document, name);
    file.create({ overwrite: true });
    file.write(text);
  };
  return {
    get: async (k) => (await read())[k] ?? null,
    set: async (k, v) => write({ ...(await read()), [k]: v }),
    remove: async (k) => {
      const all = await read();
      delete all[k];
      await write(all);
    },
  };
}

/** Keys and the server token: Keychain / Keystore (localStorage on the web, which is not secure). */
export function secretStorage(): KeyValue {
  return {
    get: async (k) => (web ? (globalThis.localStorage?.getItem(k) ?? null) : SecureStore.getItemAsync(k)),
    set: async (k, v) => (web ? void globalThis.localStorage?.setItem(k, v) : SecureStore.setItemAsync(k, v)),
    remove: async (k) => (web ? void globalThis.localStorage?.removeItem(k) : SecureStore.deleteItemAsync(k)),
  };
}

type ExpoNotifications = typeof import("expo-notifications");
const DEAL_CHANNEL = "shop-deals";
let dealNotifications: Promise<ExpoNotifications | null> | null = null;

function loadDeals(): Promise<ExpoNotifications | null> {
  if (web) return Promise.resolve(null);
  dealNotifications ??= (async () => {
    try {
      const n = await import("expo-notifications");
      if (Platform.OS === "android") {
        await n.setNotificationChannelAsync(DEAL_CHANNEL, { name: "Deals", importance: n.AndroidImportance.HIGH });
      }
      return n;
    } catch {
      return null;
    }
  })();
  return dealNotifications;
}

export type HostOptions = {
  /** The generated `ShopBackend` of the native module, or null in builds without it. */
  ShopBackend?: { start(config: { dbPath: string; sourcesJson?: string; claudeApiKey?: string; openaiApiKey?: string }): Promise<ShopBackendHandle> } | null;
  sharedServer?: () => Promise<ShopServerConfig | null>;
  onExit?: () => void;
};

export function createHost(opts: HostOptions = {}): ModuleHost {
  const documentDir = web ? "" : decodeURI(Paths.document.uri).replace(/^file:\/\//, "").replace(/\/?$/, "/");
  const backend = opts.ShopBackend;
  return {
    storage: fileStorage(),
    secrets: secretStorage(),
    sharedServer: opts.sharedServer,
    startEmbedded: backend ? (c: EmbeddedStart) => backend.start(c) : null,
    progress: () => createProgressSurface(),
    dataDir: documentDir,
    onExit: opts.onExit,
    notices: {
      requestPermission: requestProgressPermission,
      present: async (notice: LocalNotice) => {
        const n = await loadDeals();
        if (!n) return;
        await n.scheduleNotificationAsync({
          identifier: notice.id,
          content: { title: notice.title, body: notice.body, data: notice.data },
          trigger: Platform.OS === "android" ? { channelId: DEAL_CHANNEL } : null,
        });
      },
      pushToken: async () => {
        const n = await loadDeals();
        if (!n) return null;
        const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
        try {
          const t = await n.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
          return t.data;
        } catch {
          return null;
        }
      },
    },
  };
}
