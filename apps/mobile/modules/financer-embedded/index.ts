// Placeholder for the generated bindings of crates/embedded (see docs/EMBEDDED.md).
//
// `uniffi-bindgen-react-native` generates the real module here: a `Backend` class with
// `Backend.start(config)`, `backend.handle(request)` and `backend.refreshPrices()`. Until that
// is built, `Backend` is `null`, which the app reports as "not available in this build".

export type StartConfig = {
  dbPath: string;
  claudeApiKey: string | undefined;
  openaiApiKey: string | undefined;
  fintsProductId: string | undefined;
  priceSourcesJson: string | undefined;
};

export type BackendHandle = {
  handle(request: {
    method: string;
    pathAndQuery: string;
    contentType: string | undefined;
    body: ArrayBuffer;
  }): Promise<{ status: number; contentType: string | undefined; body: ArrayBuffer }>;
  refreshPrices(): Promise<string>;
};

export const Backend: { start(config: StartConfig): Promise<BackendHandle> } | null = null;
