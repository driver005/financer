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
