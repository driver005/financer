// What a host app (the standalone shopping app, or the finance app that bundles the module)
// provides. The module never touches the device directly; it asks the host.

import type { ProgressSurface } from "./logic/progress";
import type { LocalNotice } from "./logic/dealNotifications";
import type { Caller } from "../../wire/src";

/** Where a server is and the token it accepts. */
export type ShopServerConfig = { baseUrl: string; token: string };

/** The shopping backend that runs inside the app: the SDK's calls, in process. */
export interface ShopBackendHandle {
  call(app: "shop", op: string, args: string): Promise<string>;
  checkDeals?(): Promise<number>;
}

export type KeyValue = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export type EmbeddedStart = {
  /** Absolute path of the SQLite file, chosen by the host (its document directory). */
  dbPath: string;
  sourcesJson?: string;
  claudeApiKey?: string;
  openaiApiKey?: string;
};

export type ModuleHost = {
  /** Settings that are not secret (mode, server address, sources). */
  storage: KeyValue;
  /** The server token and the API keys: the Keychain / Keystore. */
  secrets: KeyValue;
  /**
   * The server the host already talks to. The bundled app passes the finance app's server and
   * token, so one setup serves both apps; the standalone app has none.
   */
  sharedServer?: () => Promise<ShopServerConfig | null>;
  /**
   * The shopping API of a server, called through the Rust SDK (docs/SDK.md). The host makes it: the
   * module has no way to reach a server of its own.
   */
  makeCaller?: (config: ShopServerConfig) => Promise<Caller>;
  /** Start the Rust shopping backend of this build; absent or null when the build has none. */
  startEmbedded?: ((config: EmbeddedStart) => Promise<ShopBackendHandle>) | null;
  /** Where the index run's progress is shown (a notification). */
  progress: (query: string, onStop?: () => void) => ProgressSurface;
  notices: {
    requestPermission(): Promise<boolean>;
    present(notice: LocalNotice): Promise<void>;
    /** An Expo push token to register with a server, or null when push is not available. */
    pushToken?(): Promise<string | null>;
  };
  /** Shown as a back button on the first screen when the module lives inside another app. */
  onExit?: () => void;
  /** Directory for the on-phone database. */
  dataDir?: string;
};
