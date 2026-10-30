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
import type { ShopTransport } from "./transport";

export class ShopApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** One entry per problem when the server refused a definition (a category, a watch). */
    public problems: string[] = [],
  ) {
    super(message);
  }
}

const PREFIX = "/v1/shop";

/** Typed client for the shopping API (`/v1/shop`), the same on a server and on the phone. */
export class ShopClient {
  constructor(private transport: ShopTransport) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.transport.send({
      method,
      path: PREFIX + path,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) {
      let message = `request failed (${res.status})`;
      let problems: string[] = [];
      try {
        const parsed = JSON.parse(res.text) as { error?: string; problems?: string[] };
        if (parsed.error) message = parsed.error;
        if (Array.isArray(parsed.problems)) problems = parsed.problems;
      } catch {
        if (res.status === 401) message = "The server did not accept the token.";
        else if (res.text && res.text.length < 200) message = res.text;
      }
      throw new ShopApiError(res.status, message, problems);
    }
    return (res.status === 204 || res.text === "" ? undefined : JSON.parse(res.text)) as T;
  }

  info = () => this.call<ShopInfo>("GET", "/info");

  categories = () => this.call<CategoryItem[]>("GET", "/categories");
  category = (id: string) => this.call<CategoryDetail>("GET", `/categories/${encodeURIComponent(id)}`);
  saveCategory = (schema: CategorySchema) => this.call<CategoryDetail>("PUT", `/categories/${encodeURIComponent(schema.id)}`, schema);
  deleteCategory = (id: string) => this.call<void>("DELETE", `/categories/${encodeURIComponent(id)}`);

  search = (req: SearchRequest) => this.call<SearchResponse>("POST", "/search", req);
  compare = (productIds: string[], profile?: Profile) =>
    this.call<Comparison>("POST", "/compare", { product_ids: productIds, profile });

  products = (category?: string, limit = 50, offset = 0) => {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (category) q.set("category", category);
    return this.call<Product[]>("GET", `/products?${q}`);
  };
  product = (id: string) => this.call<ProductDetail>("GET", `/products/${encodeURIComponent(id)}`);
  editProduct = (
    id: string,
    edit: { title?: string; brand?: string; tags?: string[]; attributes?: Record<string, import("./types").AttrValue | null> },
  ) => this.call<Product>("PUT", `/products/${encodeURIComponent(id)}`, edit);
  addProduct = (p: {
    category: string;
    title: string;
    brand?: string;
    attributes?: Product["attributes"];
    offers?: Product["offers"];
  }) => this.call<Product>("POST", "/products", p);
  deleteProduct = (id: string) => this.call<void>("DELETE", `/products/${encodeURIComponent(id)}`);

  profiles = () => this.call<{ name: string; profile: Profile }[]>("GET", "/profiles");
  saveProfile = (name: string, profile: Profile) => this.call<Profile>("PUT", `/profiles/${encodeURIComponent(name)}`, profile);
  deleteProfile = (name: string) => this.call<void>("DELETE", `/profiles/${encodeURIComponent(name)}`);

  myPlan = (category: string) => this.call<MyPlan | null>("GET", `/my/${encodeURIComponent(category)}`);
  saveMyPlan = (category: string, plan: MyPlan) => this.call<MyPlan>("PUT", `/my/${encodeURIComponent(category)}`, plan);

  startIndex = (req: IndexRequest) => this.call<JobView>("POST", "/index", req);
  indexJob = (id: string) => this.call<JobView>("GET", `/index/${encodeURIComponent(id)}`);
  cancelIndex = (id: string) => this.call<JobView>("DELETE", `/index/${encodeURIComponent(id)}`);
  indexJobs = () => this.call<JobView[]>("GET", "/index");

  watches = () => this.call<Watch[]>("GET", "/watches");
  createWatch = (w: Watch) => this.call<Watch>("POST", "/watches", w);
  updateWatch = (w: Watch & { id: number }) => this.call<Watch>("PUT", `/watches/${w.id}`, w);
  deleteWatch = (id: number) => this.call<void>("DELETE", `/watches/${id}`);

  deals = (category?: string, limit = 30) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (category) q.set("category", category);
    return this.call<DealItem[]>("GET", `/deals?${q}`);
  };

  notifications = (after = 0, limit = 50) => this.call<Notifications>("GET", `/notifications?after=${after}&limit=${limit}`);
  markRead = (upTo: number) => this.call<{ marked: number; unread: number }>("POST", "/notifications/read", { up_to: upTo });
  addPushToken = (token: string) => this.call<void>("POST", "/push-tokens", { token });
  removePushToken = (token: string) => this.call<void>("DELETE", "/push-tokens", { token });
}
