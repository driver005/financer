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

export type StartedEmbedded = EmbeddedBackend & Pick<BackendHandle, "refreshPrices">;

/** Start the on-phone backend. Throws when the native module is missing or the start fails. */
export async function startEmbedded(settings: EmbeddedSettings): Promise<StartedEmbedded> {
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
