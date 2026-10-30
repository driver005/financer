// The shopping assistant module. See docs/SHOP.md.

export { ShoppingModule } from "./ui/ShoppingModule";
export type { ModuleHost, KeyValue, EmbeddedStart } from "./host";
export { ShopClient, ShopApiError } from "./api/client";
export { RemoteShopTransport, EmbeddedShopTransport } from "./api/transport";
export type { ShopTransport, ShopBackendHandle, ShopServerConfig } from "./api/transport";
export { progressModel, followJob, textBar } from "./logic/progress";
export type { ProgressSurface, ProgressModel } from "./logic/progress";
export type { LocalNotice } from "./logic/dealNotifications";
