// The shopping assistant module. See docs/SHOP.md.

export { ShoppingModule } from "./ui/ShoppingModule";
export type { ModuleHost, KeyValue, EmbeddedStart, ShopBackendHandle, ShopServerConfig } from "./host";
export { ShopClient, ShopApiError, shopCaller } from "./api/client";
export { progressModel, followJob, textBar } from "./logic/progress";
export type { ProgressSurface, ProgressModel } from "./logic/progress";
export type { LocalNotice } from "./logic/dealNotifications";
export { createHost } from "./native/hostDefaults";
export type { HostOptions } from "./native/hostDefaults";
export { registerIndexService, hasNativeProgress } from "./native/progressSurface";
