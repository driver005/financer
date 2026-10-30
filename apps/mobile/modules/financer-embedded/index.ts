// Placeholder for the generated bindings of crates/embedded (see docs/EMBEDDED.md).
//
// `uniffi-bindgen-react-native` generates the real module here: a `Backend` class with
// `Backend.start(config)`, `backend.handle(request)`, `backend.refreshPrices()` and `backend.syncReceiptsNow()`. Until that
// is built, `Backend` is `null`, which the app reports as "not available in this build".

export type StartConfig = {
  dbPath: string;
  claudeApiKey: string | undefined;
  openaiApiKey: string | undefined;
  fintsProductId: string | undefined;
  priceSourcesJson: string | undefined;
  lidlPlus: boolean;
  lidlCountry: string | undefined;
  lidlLanguage: string | undefined;
  lidlPollHours: number | undefined;
  deviceSecret: string | undefined;
};

export type BackendHandle = {
  handle(request: {
    method: string;
    pathAndQuery: string;
    contentType?: string;
    body: ArrayBuffer;
  }): Promise<{ status: number; contentType?: string; body: ArrayBuffer }>;
  refreshPrices(): Promise<string>;
  syncReceiptsNow(): Promise<string>;
};

export const Backend: { start(config: StartConfig): Promise<BackendHandle> } | null = null;

/** A new random secret for `StartConfig.deviceSecret` (the generated module provides the real one). */
export const generateDeviceSecret: (() => string) | null = null;

/**
 * The shopping assistant's on-phone backend, from the same native library. `null` here for the
 * same reason as `Backend`; scripts/enable-embedded.sh replaces this file with the generated one.
 */
export type ShopStartConfig = {
  dbPath: string;
  sourcesJson: string | undefined;
  claudeApiKey: string | undefined;
  openaiApiKey: string | undefined;
};

export const ShopBackend: { start(config: ShopStartConfig): Promise<Pick<BackendHandle, "handle">> } | null = null;
