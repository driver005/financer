// The shopping API as the Rust side serves it (crates/shop-api). Written by hand, not generated:
// the types are small and the Rust structs are the source of truth (see docs/SHOP.md).

export type AttrValue = boolean | number | string | string[];
export type Attributes = Record<string, AttrValue>;

export type Condition = "new" | "refurbished" | "used";

export type Recurring = {
  monthly_cents: number;
  min_term_months?: number;
  promo_months?: number;
  promo_monthly_cents?: number | null;
  setup_cents?: number;
  cashback_cents?: number;
};

export type Offer = {
  shop: string;
  url: string;
  price_cents: number;
  currency?: string;
  shipping_cents?: number;
  in_stock?: boolean;
  condition?: Condition;
  list_price_cents?: number | null;
  recurring?: Recurring | null;
  seen_at?: number;
};

export type Product = {
  id: string;
  category: string;
  title: string;
  brand?: string | null;
  model?: string | null;
  gtin?: string | null;
  image?: string | null;
  attributes: Attributes;
  offers: Offer[];
  tags?: string[];
};

// ---- schemas: the extension point -------------------------------------------------------------

export type AttrKind = "number" | "text" | "bool" | "list";

export type AttributeDef = {
  key: string;
  label: string;
  kind?: AttrKind;
  unit?: string | null;
  aliases?: string[];
  units?: Record<string, number>;
  words?: Record<string, number>;
};

export type Scale = { type: "minmax" } | { type: "percentile" } | { type: "fixed"; min: number; max: number };
export type Missing = "skip" | "neutral" | "worst";

export type CriterionKindDef =
  | { kind: "number"; attribute: string }
  | { kind: "choice"; attribute: string; scores: Record<string, number>; default?: number | null }
  | { kind: "flag"; attribute: string }
  | { kind: "match"; attribute: string; preference: string }
  | { kind: "age"; attribute: string; half_life_months: number }
  | { kind: "formula"; expr: string }
  | { kind: "price" }
  | { kind: "deal" };

export type CriterionDef = {
  key: string;
  label: string;
  description?: string;
  weight?: number;
  higher_is_better?: boolean | null;
  scale?: Scale;
  log?: boolean;
  missing?: Missing;
  group?: string | null;
} & CriterionKindDef;

export type DeriveRule = { attribute: string; from: string; contains: string; add: string[] };

export type CategoryKind = "product" | "subscription";

export type CategorySchema = {
  id: string;
  name: string;
  kind?: CategoryKind;
  extends?: string | null;
  keywords?: string[];
  name_words?: string[];
  attributes?: AttributeDef[];
  derive?: DeriveRule[];
  criteria?: CriterionDef[];
  tiers?: string[];
  remove?: string[];
};

export type CategoryItem = {
  id: string;
  name: string;
  kind: CategoryKind;
  extends: string | null;
  builtin: boolean;
  customized: boolean;
  criteria: number;
  attributes: number;
  products: number;
};

export type CategoryDetail = { resolved: CategorySchema; raw: CategorySchema; builtin: boolean; customized: boolean };

// ---- profiles and ranking ---------------------------------------------------------------------

export type Op = "gte" | "lte" | "eq" | "ne" | "contains" | "any_of";
export type Constraint = { attribute: string; op: Op; value: AttrValue };
export type Preference = { prefer?: string[]; avoid?: string[] };

export type Profile = {
  weights?: Record<string, number>;
  constraints?: Constraint[];
  preferences?: Record<string, Preference>;
  max_price_cents?: number | null;
  horizon_months?: number;
  conditions?: Condition[];
  in_stock_only?: boolean;
  exclude_brands?: string[];
  extra_criteria?: CriterionDef[];
};

export type CriterionScore = {
  key: string;
  label: string;
  group: string | null;
  weight: number;
  value: string | null;
  score: number | null;
  points: number;
};

export type Ranked = {
  product_id: string;
  score: number;
  confidence: number;
  quality: number | null;
  value_index: number | null;
  price_cents: number | null;
  shop: string | null;
  url: string | null;
  tier: string | null;
  on_frontier: boolean;
  breakdown: CriterionScore[];
  strengths: string[];
  weaknesses: string[];
};

export type Verdict = "none" | "fair" | "good" | "great";

export type DealInfo = {
  current_cents: number;
  reference_cents: number | null;
  discount_pct: number;
  lowest_cents: number | null;
  lowest_90d: boolean;
  all_time_low: boolean;
  samples: number;
  verdict: Verdict;
};

export type Saving = { per_month_cents: number; over_horizon_cents: number; current: string | null };

export type SearchItem = { product: Product; ranked: Ranked; deal: DealInfo | null; saving: Saving | null };

export type Picks = {
  best_overall: string | null;
  best_value: string | null;
  cheapest_good: string | null;
  premium: string | null;
};

export type TierBand = { label: string; from_cents: number; to_cents: number; count: number };

export type ParsedQuery = {
  text: string;
  terms: string[];
  category: string | null;
  max_price_cents: number | null;
  constraints: Constraint[];
};

export type SearchRequest = {
  query: string;
  category?: string;
  profile?: Profile;
  profile_name?: string;
  limit?: number;
};

export type SearchResponse = {
  category: string | null;
  category_guessed: boolean;
  parsed: ParsedQuery;
  profile: Profile;
  items: SearchItem[];
  excluded: { product_id: string; reasons: string[] }[];
  picks: Picks;
  tiers: TierBand[];
  candidates: number;
  catalogue: { products_in_category: number; newest_offer_at: number; stale: boolean };
};

export type Comparison = {
  category: string;
  columns: {
    product_id: string;
    title: string;
    brand: string | null;
    price_cents: number | null;
    shop: string | null;
    score: number;
    confidence: number;
    tier: string | null;
  }[];
  rows: {
    key: string;
    label: string;
    group: string | null;
    kind: "price" | "criterion" | "spec";
    weight: number;
    cells: { value: string | null; score: number | null; best: boolean }[];
  }[];
  winner: string | null;
};

export type ProductDetail = {
  product: Product;
  deal: DealInfo | null;
  history: { at: number; cents: number }[];
  schema: CategorySchema;
};

export type MyPlan = { name?: string | null; monthly_cents: number; ends_on?: string | null };

// ---- index jobs --------------------------------------------------------------------------------

export type Phase = "queued" | "running" | "done" | "failed" | "cancelled";

export type ProgressState = {
  phase: Phase;
  message: string;
  done: number;
  total: number;
  products: number;
  failed: number;
  percent: number;
};

export type IndexReport = {
  pages: number;
  failed: number;
  new_products: number;
  price_changes: number;
  unchanged: number;
  skipped: number;
  sources: Record<string, { pages: number; failed: number; products: number; last_error: string | null }>;
  unclaimed_labels: [string, number][];
  cancelled: boolean;
};

export type JobView = {
  id: string;
  query: string;
  category: string | null;
  started_at: number;
  progress: ProgressState;
  report: IndexReport | null;
};

export type IndexRequest = { query: string; category?: string; sources?: string[]; max_pages?: number };

// ---- watches and messages ------------------------------------------------------------------------

export type Watch = {
  id?: number;
  name: string;
  category?: string | null;
  query?: string | null;
  product_ids?: string[];
  max_price_cents?: number | null;
  min_discount_pct?: number | null;
  enabled?: boolean;
};

export type DealEvent = {
  key: string;
  watch_id: number;
  watch_name: string;
  product_id: string;
  title: string;
  shop: string;
  url: string;
  price_cents: number;
  reference_cents: number | null;
  discount_pct: number;
  verdict: Verdict;
  kind: "below_target" | "deal" | "new_low";
};

export type Notification = { id: number; created_at: number; read: boolean; message: string; event: DealEvent };
export type Notifications = { items: Notification[]; unread: number; last_id: number };

export type DealItem = { product: Product; deal: DealInfo };

export type ShopInfo = {
  mode: "integrated" | "server";
  continuous: boolean;
  products: number;
  categories: number;
  sources: { name: string; kind: string; category: string | null }[];
  notifiers: string[];
  llm: boolean;
  watches: number;
  unread: number;
  running_jobs: number;
  last_error: string | null;
};
