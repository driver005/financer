import type {
  CategoryDetail,
  CategoryItem,
  CategorySchema,
  Comparison,
  DealItem,
  IndexRequest,
  JobView,
  MyPlan,
  Notifications,
  Product,
  ProductDetail,
  Profile,
  SearchRequest,
  SearchResponse,
  ShopInfo,
  Watch,
} from "./types";
import { bind, CallError, type Caller, type WireLike } from "../../../wire/src";

export class ShopApiError extends CallError {
  constructor(status: number, message: string, problems: string[] = []) {
    super(status, status === 401 ? "The server did not accept the token." : message, problems);
  }
}

/** The shopping API of a connection (a server through the Rust SDK, or the backend inside the app). */
export function shopCaller(wire: WireLike): Caller {
  return bind(wire, "shop", ShopApiError);
}

/**
 * The shopping API (`/v1/shop`) as the screens use it. Every method names a call of the Rust SDK and
 * passes its values by name; the paths, the encoding and the checking of the answer are the SDK's
 * (crates/sdk, docs/SDK.md). The same on a server and on the phone.
 */
export class ShopClient {
  constructor(private caller: Caller) {}

  private op<T>(op: string, args?: Record<string, unknown>) {
    return this.caller.call<T>(op, args);
  }

  info = () => this.op<ShopInfo>("info");

  categories = () => this.op<CategoryItem[]>("categories");
  category = (id: string) => this.op<CategoryDetail>("category", { id });
  saveCategory = (schema: CategorySchema) => this.op<CategoryDetail>("save_category", { body: schema });
  deleteCategory = (id: string) => this.op<void>("delete_category", { id });

  search = (req: SearchRequest) => this.op<SearchResponse>("search", { body: req });
  compare = (productIds: string[], profile?: Profile) => this.op<Comparison>("compare", { product_ids: productIds, profile });

  products = (category?: string, limit = 50, offset = 0) => this.op<Product[]>("products", { category, limit, offset });
  product = (id: string) => this.op<ProductDetail>("product", { id });
  editProduct = (
    id: string,
    edit: { title?: string; brand?: string; tags?: string[]; attributes?: Record<string, import("./types").AttrValue | null> },
  ) => this.op<Product>("edit_product", { id, edit });
  addProduct = (p: {
    category: string;
    title: string;
    brand?: string;
    gtin?: string;
    attributes?: Product["attributes"];
    offers?: Product["offers"];
  }) => this.op<Product>("add_product", { body: p });
  deleteProduct = (id: string) => this.op<void>("delete_product", { id });

  profiles = () => this.op<{ name: string; profile: Profile }[]>("profiles");
  saveProfile = (name: string, profile: Profile) => this.op<Profile>("save_profile", { name, profile });
  deleteProfile = (name: string) => this.op<void>("delete_profile", { name });

  myPlan = (category: string) => this.op<MyPlan | null>("my_plan", { category });
  saveMyPlan = (category: string, plan: MyPlan) => this.op<MyPlan>("save_my_plan", { category, plan });

  startIndex = (req: IndexRequest) => this.op<JobView>("start_index", { body: req });
  indexJob = (id: string) => this.op<JobView>("index_job", { id });
  cancelIndex = (id: string) => this.op<JobView>("cancel_index", { id });
  indexJobs = () => this.op<JobView[]>("index_jobs");

  watches = () => this.op<Watch[]>("watches");
  createWatch = (w: Watch) => this.op<Watch>("create_watch", { body: w });
  updateWatch = (w: Watch & { id: number }) => this.op<Watch>("update_watch", { id: w.id, watch: w });
  deleteWatch = (id: number) => this.op<void>("delete_watch", { id });

  deals = (category?: string, limit = 30) => this.op<DealItem[]>("deals", { category, limit });

  notifications = (after = 0, limit = 50) => this.op<Notifications>("notifications", { after, limit });
  markRead = (upTo: number) => this.op<{ marked: number; unread: number }>("mark_read", { up_to: upTo });
  addPushToken = (token: string) => this.op<void>("add_push_token", { token });
  removePushToken = (token: string) => this.op<void>("remove_push_token", { token });
}
