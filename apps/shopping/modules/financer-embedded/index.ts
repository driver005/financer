// Placeholder for the generated bindings of crates/embedded (see docs/SHOP.md and docs/EMBEDDED.md).
//
// `scripts/enable-embedded.sh` replaces this file with the real module: a `ShopBackend` class with
// `ShopBackend.start(config)` and `backend.handle(request)`. Until then `ShopBackend` is `null`,
// and the app offers only "My server" (it still runs in Expo Go and in the browser).

import type { ShopBackendHandle } from "../../../../packages/shopping/src";

export type ShopStartConfig = {
  dbPath: string;
  sourcesJson?: string;
  claudeApiKey?: string;
  openaiApiKey?: string;
};

export const ShopBackend: { start(config: ShopStartConfig): Promise<ShopBackendHandle> } | null = null;
