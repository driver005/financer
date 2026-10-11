import { Paths } from "expo-file-system";

import type { EmbeddedBackend } from "@/api/transport";
import { Backend, type BackendHandle } from "../../modules/financer-embedded";

export type EmbeddedSettings = {
  claudeApiKey: string;
  openaiApiKey: string;
  fintsProductId: string;
  priceSourcesJson: string;
};

export const EMPTY_EMBEDDED_SETTINGS: EmbeddedSettings = {
  claudeApiKey: "",
  openaiApiKey: "",
  fintsProductId: "",
  priceSourcesJson: "",
};

/** True when this build contains the Rust backend (a custom dev build with the native module). */
export const embeddedAvailable = Backend !== null;

/** Where the on-phone settings are kept (also read by the background task). */
export const EMBEDDED_KEY = "financer.embedded-settings";

export type StartedEmbedded = EmbeddedBackend & Pick<BackendHandle, "refreshPrices">;

let cached: { key: string; promise: Promise<StartedEmbedded> } | null = null;

/**
 * Start the on-phone backend, or return the one already started with the same settings. The
 * screens and the background task must share one instance: two instances would open the same
 * SQLite file twice.
 */
export function startEmbedded(settings: EmbeddedSettings): Promise<StartedEmbedded> {
  const key = JSON.stringify(settings);
  if (cached?.key === key) return cached.promise;
  const promise = startNew(settings);
  cached = { key, promise };
  promise.catch(() => {
    if (cached?.promise === promise) cached = null; // a failed start can be retried
  });
  return promise;
}

async function startNew(settings: EmbeddedSettings): Promise<StartedEmbedded> {
  if (!Backend) throw new Error("This build does not include the on-phone backend (see docs/EMBEDDED.md).");
  // The database lives in the app's private document directory.
  const dir = decodeURI(Paths.document.uri).replace(/^file:\/\//, "").replace(/\/?$/, "/");
  return Backend.start({
    dbPath: `${dir}financer.db`,
    claudeApiKey: settings.claudeApiKey || undefined,
    openaiApiKey: settings.openaiApiKey || undefined,
    fintsProductId: settings.fintsProductId || undefined,
    priceSourcesJson: settings.priceSourcesJson || undefined,
  });
}
