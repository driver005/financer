//! The shopping assistant's API (`/v1/shop`) as typed calls.
//!
//! Every request and every answer is a record. Three kinds of value stay open, because the server
//! stores them as open maps and tagged unions (see `docs/SDK.md`): an attribute value (a flag, a
//! number, a text or a list of texts), a criterion (its `kind` decides the other fields) and the
//! `null`s that remove an attribute. JavaScript gets them as JSON text (`JSON.parse` it).
//!
//! The tests drive each call against the real shop router, so a route that moves breaks the build.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::call::{encode, parse_args, query, to_json, Caller};
use crate::error::SdkError;
use crate::json::JsonValue;
use crate::transport::Transport;

const P: &str = "/v1/shop";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "snake_case")]
pub enum ShopMode {
    Integrated,
    Server,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "snake_case")]
pub enum Condition {
    New,
    Refurbished,
    Used,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "snake_case")]
pub enum CategoryKind {
    Product,
    Subscription,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "snake_case")]
pub enum Op {
    Gte,
    Lte,
    Eq,
    Ne,
    Contains,
    AnyOf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    None,
    Fair,
    Good,
    Great,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "snake_case")]
pub enum RowKind {
    Price,
    Criterion,
    Spec,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    BelowTarget,
    Deal,
    NewLow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, uniffi::Enum)]
#[serde(rename_all = "snake_case")]
pub enum AttrKind {
    Number,
    Text,
    Bool,
    List,
}

// ---- products ------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Recurring {
    pub monthly_cents: i64,
    #[serde(default)]
    pub min_term_months: u32,
    #[serde(default)]
    pub promo_months: u32,
    #[serde(default)]
    pub promo_monthly_cents: Option<i64>,
    #[serde(default)]
    pub setup_cents: i64,
    #[serde(default)]
    pub cashback_cents: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Offer {
    pub shop: String,
    pub url: String,
    pub price_cents: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shipping_cents: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_stock: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub condition: Option<Condition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list_price_cents: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recurring: Option<Recurring>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seen_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Product {
    pub id: String,
    pub category: String,
    pub title: String,
    #[serde(default)]
    pub brand: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub gtin: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    /// Attribute values by key; each value is a flag, a number, a text or a list of texts.
    #[serde(default)]
    pub attributes: HashMap<String, JsonValue>,
    #[serde(default)]
    pub offers: Vec<Offer>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct ProductEdit {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brand: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Set or change attributes; the JSON `null` removes one.
    #[serde(default)]
    pub attributes: HashMap<String, JsonValue>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct NewProduct {
    pub category: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub brand: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gtin: Option<String>,
    #[serde(default)]
    pub attributes: HashMap<String, JsonValue>,
    #[serde(default)]
    pub offers: Vec<Offer>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct PricePoint {
    pub at: i64,
    pub cents: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct DealInfo {
    pub current_cents: i64,
    pub reference_cents: Option<i64>,
    pub discount_pct: f64,
    pub lowest_cents: Option<i64>,
    pub lowest_90d: bool,
    pub all_time_low: bool,
    pub samples: u64,
    pub verdict: Verdict,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct DealItem {
    pub product: Product,
    pub deal: DealInfo,
}

// ---- categories ----------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct AttributeDef {
    pub key: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<AttrKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aliases: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub units: Option<HashMap<String, f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub words: Option<HashMap<String, f64>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct DeriveRule {
    pub attribute: String,
    pub from: String,
    pub contains: String,
    pub add: Vec<String>,
}

/// A product category: what is stored of a product and how it is judged. A criterion's `kind`
/// (number, choice, flag, match, age, formula, price, deal) decides its other fields, so each one
/// is open JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct CategorySchema {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<CategoryKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extends: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keywords: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_words: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attributes: Option<Vec<AttributeDef>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derive: Option<Vec<DeriveRule>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub criteria: Option<Vec<JsonValue>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tiers: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remove: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct CategoryItem {
    pub id: String,
    pub name: String,
    pub kind: CategoryKind,
    pub extends: Option<String>,
    pub builtin: bool,
    pub customized: bool,
    pub criteria: u64,
    pub attributes: u64,
    pub products: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct CategoryDetail {
    pub resolved: CategorySchema,
    pub raw: CategorySchema,
    pub builtin: bool,
    pub customized: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct ProductDetail {
    pub product: Product,
    pub deal: Option<DealInfo>,
    pub history: Vec<PricePoint>,
    pub schema: CategorySchema,
}

// ---- profiles, search, compare -------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Constraint {
    pub attribute: String,
    pub op: Op,
    /// The value compared with: a flag, a number, a text or a list of texts.
    pub value: JsonValue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Preference {
    #[serde(default)]
    pub prefer: Vec<String>,
    #[serde(default)]
    pub avoid: Vec<String>,
}

/// What a person cares about. Everything is optional when sending: the server fills the defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Profile {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weights: Option<HashMap<String, f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub constraints: Option<Vec<Constraint>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preferences: Option<HashMap<String, Preference>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_price_cents: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub horizon_months: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<Condition>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_stock_only: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude_brands: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_criteria: Option<Vec<JsonValue>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct NamedProfile {
    pub name: String,
    pub profile: Profile,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct SearchRequest {
    pub query: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<Profile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct CriterionScore {
    pub key: String,
    pub label: String,
    pub group: Option<String>,
    pub weight: f64,
    pub value: Option<String>,
    pub score: Option<f64>,
    pub points: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Ranked {
    pub product_id: String,
    pub score: f64,
    pub confidence: f64,
    pub quality: Option<f64>,
    pub value_index: Option<f64>,
    pub price_cents: Option<i64>,
    pub shop: Option<String>,
    pub url: Option<String>,
    pub tier: Option<String>,
    pub on_frontier: bool,
    pub breakdown: Vec<CriterionScore>,
    pub strengths: Vec<String>,
    pub weaknesses: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Saving {
    pub per_month_cents: i64,
    pub over_horizon_cents: i64,
    pub current: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct SearchItem {
    pub product: Product,
    pub ranked: Ranked,
    pub deal: Option<DealInfo>,
    pub saving: Option<Saving>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Excluded {
    pub product_id: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Picks {
    pub best_overall: Option<String>,
    pub best_value: Option<String>,
    pub cheapest_good: Option<String>,
    pub premium: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct TierBand {
    pub label: String,
    pub from_cents: i64,
    pub to_cents: i64,
    pub count: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct ParsedQuery {
    pub text: String,
    pub terms: Vec<String>,
    pub category: Option<String>,
    pub max_price_cents: Option<i64>,
    pub constraints: Vec<Constraint>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct CatalogueInfo {
    pub products_in_category: u64,
    pub newest_offer_at: i64,
    pub stale: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct SearchResponse {
    pub category: Option<String>,
    pub category_guessed: bool,
    pub parsed: ParsedQuery,
    pub profile: Profile,
    pub items: Vec<SearchItem>,
    pub excluded: Vec<Excluded>,
    pub picks: Picks,
    pub tiers: Vec<TierBand>,
    pub candidates: u64,
    pub catalogue: CatalogueInfo,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct CompareColumn {
    pub product_id: String,
    pub title: String,
    pub brand: Option<String>,
    pub price_cents: Option<i64>,
    pub shop: Option<String>,
    pub score: f64,
    pub confidence: f64,
    pub tier: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct CompareCell {
    pub value: Option<String>,
    pub score: Option<f64>,
    pub best: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct CompareRow {
    pub key: String,
    pub label: String,
    pub group: Option<String>,
    pub kind: RowKind,
    pub weight: f64,
    pub cells: Vec<CompareCell>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Comparison {
    pub category: String,
    pub columns: Vec<CompareColumn>,
    pub rows: Vec<CompareRow>,
    pub winner: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
struct CompareRequest {
    product_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    profile: Option<Profile>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct MyPlan {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub monthly_cents: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ends_on: Option<String>,
}

// ---- indexing ------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct IndexRequest {
    pub query: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_pages: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct ProgressState {
    pub phase: Phase,
    pub message: String,
    pub done: u64,
    pub total: u64,
    pub products: u64,
    pub failed: u64,
    pub percent: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct SourceReport {
    pub pages: u64,
    pub failed: u64,
    pub products: u64,
    pub last_error: Option<String>,
}

/// A label the index did not know, and how often it showed up.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct UnclaimedLabel {
    pub label: String,
    pub count: u64,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct IndexReport {
    pub pages: u64,
    pub failed: u64,
    pub new_products: u64,
    pub price_changes: u64,
    pub unchanged: u64,
    pub skipped: u64,
    pub sources: HashMap<String, SourceReport>,
    pub unclaimed_labels: Vec<UnclaimedLabel>,
    pub cancelled: bool,
}

// The server writes `unclaimed_labels` as [label, count] pairs.
impl Serialize for IndexReport {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("IndexReport", 9)?;
        st.serialize_field("pages", &self.pages)?;
        st.serialize_field("failed", &self.failed)?;
        st.serialize_field("new_products", &self.new_products)?;
        st.serialize_field("price_changes", &self.price_changes)?;
        st.serialize_field("unchanged", &self.unchanged)?;
        st.serialize_field("skipped", &self.skipped)?;
        st.serialize_field("sources", &self.sources)?;
        let pairs: Vec<(&str, u64)> = self
            .unclaimed_labels
            .iter()
            .map(|l| (l.label.as_str(), l.count))
            .collect();
        st.serialize_field("unclaimed_labels", &pairs)?;
        st.serialize_field("cancelled", &self.cancelled)?;
        st.end()
    }
}

impl<'de> Deserialize<'de> for IndexReport {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Wire {
            pages: u64,
            failed: u64,
            new_products: u64,
            price_changes: u64,
            unchanged: u64,
            #[serde(default)]
            skipped: u64,
            #[serde(default)]
            sources: HashMap<String, SourceReport>,
            #[serde(default)]
            unclaimed_labels: Vec<(String, u64)>,
            #[serde(default)]
            cancelled: bool,
        }
        let w = Wire::deserialize(d)?;
        Ok(IndexReport {
            pages: w.pages,
            failed: w.failed,
            new_products: w.new_products,
            price_changes: w.price_changes,
            unchanged: w.unchanged,
            skipped: w.skipped,
            sources: w.sources,
            unclaimed_labels: w
                .unclaimed_labels
                .into_iter()
                .map(|(label, count)| UnclaimedLabel { label, count })
                .collect(),
            cancelled: w.cancelled,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct JobView {
    pub id: String,
    pub query: String,
    pub category: Option<String>,
    pub started_at: i64,
    pub progress: ProgressState,
    pub report: Option<IndexReport>,
}

// ---- watches, deals, notifications ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Watch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_price_cents: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_discount_pct: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct DealEvent {
    pub key: String,
    pub watch_id: i64,
    pub watch_name: String,
    pub product_id: String,
    pub title: String,
    pub shop: String,
    pub url: String,
    pub price_cents: i64,
    pub reference_cents: Option<i64>,
    pub discount_pct: f64,
    pub verdict: Verdict,
    pub kind: EventKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Notification {
    pub id: i64,
    pub created_at: i64,
    pub read: bool,
    pub message: String,
    pub event: DealEvent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct Notifications {
    pub items: Vec<Notification>,
    pub unread: u64,
    pub last_id: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct ShopMarked {
    pub marked: u64,
    pub unread: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct SourceInfo {
    pub name: String,
    pub kind: String,
    pub category: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, uniffi::Record)]
pub struct ShopInfo {
    pub mode: ShopMode,
    pub continuous: bool,
    pub products: u64,
    pub categories: u64,
    pub sources: Vec<SourceInfo>,
    pub notifiers: Vec<String>,
    pub llm: bool,
    pub watches: u64,
    pub unread: u64,
    pub running_jobs: u64,
    pub last_error: Option<String>,
}

// ---- the calls -----------------------------------------------------------------------------------

/// The shopping API of one server. Cheap to clone: it only holds the transport.
#[derive(uniffi::Object)]
pub struct ShopSdk {
    caller: Caller,
}

impl ShopSdk {
    /// A client that carries its requests with `transport`.
    pub fn with_transport(transport: Arc<dyn Transport>) -> Arc<ShopSdk> {
        Arc::new(ShopSdk {
            caller: Caller::new(transport),
        })
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: String) -> Result<T, SdkError> {
        self.caller.decode(
            self.caller
                .json("GET", format!("{P}{path}"), None::<&()>)
                .await?,
        )
    }

    async fn send<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        path: String,
        body: Option<&impl Serialize>,
    ) -> Result<T, SdkError> {
        self.caller
            .decode(self.caller.json(method, format!("{P}{path}"), body).await?)
    }

    /// A call that answers nothing (204).
    async fn done(
        &self,
        method: &str,
        path: String,
        body: Option<&impl Serialize>,
    ) -> Result<(), SdkError> {
        self.caller.json(method, format!("{P}{path}"), body).await?;
        Ok(())
    }
}

#[cfg_attr(not(target_arch = "wasm32"), uniffi::export(async_runtime = "tokio"))]
#[cfg_attr(target_arch = "wasm32", uniffi::export)]
impl ShopSdk {
    pub async fn info(&self) -> Result<ShopInfo, SdkError> {
        self.get("/info".into()).await
    }

    pub async fn categories(&self) -> Result<Vec<CategoryItem>, SdkError> {
        self.get("/categories".into()).await
    }

    pub async fn category(&self, id: String) -> Result<CategoryDetail, SdkError> {
        self.get(format!("/categories/{}", encode(&id))).await
    }

    pub async fn save_category(&self, schema: CategorySchema) -> Result<CategoryDetail, SdkError> {
        self.send(
            "PUT",
            format!("/categories/{}", encode(&schema.id)),
            Some(&schema),
        )
        .await
    }

    pub async fn delete_category(&self, id: String) -> Result<(), SdkError> {
        self.done(
            "DELETE",
            format!("/categories/{}", encode(&id)),
            None::<&()>,
        )
        .await
    }

    pub async fn search(&self, request: SearchRequest) -> Result<SearchResponse, SdkError> {
        self.send("POST", "/search".into(), Some(&request)).await
    }

    pub async fn compare(
        &self,
        product_ids: Vec<String>,
        profile: Option<Profile>,
    ) -> Result<Comparison, SdkError> {
        self.send(
            "POST",
            "/compare".into(),
            Some(&CompareRequest {
                product_ids,
                profile,
            }),
        )
        .await
    }

    pub async fn products(
        &self,
        category: Option<String>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<Product>, SdkError> {
        let q = query(&[
            ("category", category),
            ("limit", Some(limit.unwrap_or(50).to_string())),
            ("offset", Some(offset.unwrap_or(0).to_string())),
        ]);
        self.get(format!("/products{q}")).await
    }

    pub async fn product(&self, id: String) -> Result<ProductDetail, SdkError> {
        self.get(format!("/products/{}", encode(&id))).await
    }

    pub async fn edit_product(&self, id: String, edit: ProductEdit) -> Result<Product, SdkError> {
        self.send("PUT", format!("/products/{}", encode(&id)), Some(&edit))
            .await
    }

    pub async fn add_product(&self, product: NewProduct) -> Result<Product, SdkError> {
        self.send("POST", "/products".into(), Some(&product)).await
    }

    pub async fn delete_product(&self, id: String) -> Result<(), SdkError> {
        self.done("DELETE", format!("/products/{}", encode(&id)), None::<&()>)
            .await
    }

    pub async fn profiles(&self) -> Result<Vec<NamedProfile>, SdkError> {
        self.get("/profiles".into()).await
    }

    pub async fn save_profile(&self, name: String, profile: Profile) -> Result<Profile, SdkError> {
        self.send(
            "PUT",
            format!("/profiles/{}", encode(&name)),
            Some(&profile),
        )
        .await
    }

    pub async fn delete_profile(&self, name: String) -> Result<(), SdkError> {
        self.done(
            "DELETE",
            format!("/profiles/{}", encode(&name)),
            None::<&()>,
        )
        .await
    }

    /// The person's current plan in a subscription category (none when not set).
    pub async fn my_plan(&self, category: String) -> Result<Option<MyPlan>, SdkError> {
        self.get(format!("/my/{}", encode(&category))).await
    }

    pub async fn save_my_plan(&self, category: String, plan: MyPlan) -> Result<MyPlan, SdkError> {
        self.send("PUT", format!("/my/{}", encode(&category)), Some(&plan))
            .await
    }

    pub async fn start_index(&self, request: IndexRequest) -> Result<JobView, SdkError> {
        self.send("POST", "/index".into(), Some(&request)).await
    }

    pub async fn index_job(&self, id: String) -> Result<JobView, SdkError> {
        self.get(format!("/index/{}", encode(&id))).await
    }

    pub async fn cancel_index(&self, id: String) -> Result<JobView, SdkError> {
        self.send("DELETE", format!("/index/{}", encode(&id)), None::<&()>)
            .await
    }

    pub async fn index_jobs(&self) -> Result<Vec<JobView>, SdkError> {
        self.get("/index".into()).await
    }

    pub async fn watches(&self) -> Result<Vec<Watch>, SdkError> {
        self.get("/watches".into()).await
    }

    pub async fn create_watch(&self, watch: Watch) -> Result<Watch, SdkError> {
        self.send("POST", "/watches".into(), Some(&watch)).await
    }

    pub async fn update_watch(&self, id: i64, watch: Watch) -> Result<Watch, SdkError> {
        self.send("PUT", format!("/watches/{id}"), Some(&watch))
            .await
    }

    pub async fn delete_watch(&self, id: i64) -> Result<(), SdkError> {
        self.done("DELETE", format!("/watches/{id}"), None::<&()>)
            .await
    }

    pub async fn deals(
        &self,
        category: Option<String>,
        limit: Option<u32>,
    ) -> Result<Vec<DealItem>, SdkError> {
        let q = query(&[
            ("category", category),
            ("limit", Some(limit.unwrap_or(30).to_string())),
        ]);
        self.get(format!("/deals{q}")).await
    }

    pub async fn notifications(
        &self,
        after: Option<i64>,
        limit: Option<u32>,
    ) -> Result<Notifications, SdkError> {
        let q = query(&[
            ("after", Some(after.unwrap_or(0).to_string())),
            ("limit", Some(limit.unwrap_or(50).to_string())),
        ]);
        self.get(format!("/notifications{q}")).await
    }

    pub async fn mark_read(&self, up_to: i64) -> Result<ShopMarked, SdkError> {
        #[derive(Serialize)]
        struct Body {
            up_to: i64,
        }
        self.send("POST", "/notifications/read".into(), Some(&Body { up_to }))
            .await
    }

    pub async fn add_push_token(&self, token: String) -> Result<(), SdkError> {
        #[derive(Serialize)]
        struct Body {
            token: String,
        }
        self.done("POST", "/push-tokens".into(), Some(&Body { token }))
            .await
    }

    pub async fn remove_push_token(&self, token: String) -> Result<(), SdkError> {
        #[derive(Serialize)]
        struct Body {
            token: String,
        }
        self.done("DELETE", "/push-tokens".into(), Some(&Body { token }))
            .await
    }
}

// ---- one entry for the apps ----------------------------------------------------------------------

impl ShopSdk {
    /// One call by name, its arguments as a JSON object (named as the methods name them), the answer
    /// as JSON text. The apps use this one entry: the contract and the paths stay in Rust.
    pub async fn dispatch(&self, op: &str, args: &str) -> Result<String, SdkError> {
        #[derive(Deserialize)]
        struct Id {
            id: String,
        }
        #[derive(Deserialize)]
        struct Name {
            name: String,
        }
        #[derive(Deserialize)]
        struct Category {
            category: String,
        }
        #[derive(Deserialize)]
        struct Token {
            token: String,
        }
        #[derive(Deserialize)]
        struct Products {
            category: Option<String>,
            limit: Option<u32>,
            offset: Option<u32>,
        }
        #[derive(Deserialize)]
        struct Compare {
            product_ids: Vec<String>,
            profile: Option<Profile>,
        }
        #[derive(Deserialize)]
        struct EditProduct {
            id: String,
            edit: ProductEdit,
        }
        #[derive(Deserialize)]
        struct SaveProfile {
            name: String,
            profile: Profile,
        }
        #[derive(Deserialize)]
        struct SavePlan {
            category: String,
            plan: MyPlan,
        }
        #[derive(Deserialize)]
        struct WatchId {
            id: i64,
        }
        #[derive(Deserialize)]
        struct UpdateWatch {
            id: i64,
            watch: Watch,
        }
        #[derive(Deserialize)]
        struct Deals {
            category: Option<String>,
            limit: Option<u32>,
        }
        #[derive(Deserialize)]
        struct Notifs {
            after: Option<i64>,
            limit: Option<u32>,
        }
        #[derive(Deserialize)]
        struct UpTo {
            up_to: i64,
        }
        #[derive(Deserialize)]
        struct One<T> {
            body: T,
        }
        match op {
            "info" => to_json(&self.info().await?),
            "categories" => to_json(&self.categories().await?),
            "category" => {
                let a: Id = parse_args(args)?;
                to_json(&self.category(a.id).await?)
            }
            "save_category" => {
                let a: One<CategorySchema> = parse_args(args)?;
                to_json(&self.save_category(a.body).await?)
            }
            "delete_category" => {
                let a: Id = parse_args(args)?;
                self.delete_category(a.id).await.map(|()| "null".into())
            }
            "search" => {
                let a: One<SearchRequest> = parse_args(args)?;
                to_json(&self.search(a.body).await?)
            }
            "compare" => {
                let a: Compare = parse_args(args)?;
                to_json(&self.compare(a.product_ids, a.profile).await?)
            }
            "products" => {
                let a: Products = parse_args(args)?;
                to_json(&self.products(a.category, a.limit, a.offset).await?)
            }
            "product" => {
                let a: Id = parse_args(args)?;
                to_json(&self.product(a.id).await?)
            }
            "edit_product" => {
                let a: EditProduct = parse_args(args)?;
                to_json(&self.edit_product(a.id, a.edit).await?)
            }
            "add_product" => {
                let a: One<NewProduct> = parse_args(args)?;
                to_json(&self.add_product(a.body).await?)
            }
            "delete_product" => {
                let a: Id = parse_args(args)?;
                self.delete_product(a.id).await.map(|()| "null".into())
            }
            "profiles" => to_json(&self.profiles().await?),
            "save_profile" => {
                let a: SaveProfile = parse_args(args)?;
                to_json(&self.save_profile(a.name, a.profile).await?)
            }
            "delete_profile" => {
                let a: Name = parse_args(args)?;
                self.delete_profile(a.name).await.map(|()| "null".into())
            }
            "my_plan" => {
                let a: Category = parse_args(args)?;
                to_json(&self.my_plan(a.category).await?)
            }
            "save_my_plan" => {
                let a: SavePlan = parse_args(args)?;
                to_json(&self.save_my_plan(a.category, a.plan).await?)
            }
            "start_index" => {
                let a: One<IndexRequest> = parse_args(args)?;
                to_json(&self.start_index(a.body).await?)
            }
            "index_job" => {
                let a: Id = parse_args(args)?;
                to_json(&self.index_job(a.id).await?)
            }
            "cancel_index" => {
                let a: Id = parse_args(args)?;
                to_json(&self.cancel_index(a.id).await?)
            }
            "index_jobs" => to_json(&self.index_jobs().await?),
            "watches" => to_json(&self.watches().await?),
            "create_watch" => {
                let a: One<Watch> = parse_args(args)?;
                to_json(&self.create_watch(a.body).await?)
            }
            "update_watch" => {
                let a: UpdateWatch = parse_args(args)?;
                to_json(&self.update_watch(a.id, a.watch).await?)
            }
            "delete_watch" => {
                let a: WatchId = parse_args(args)?;
                self.delete_watch(a.id).await.map(|()| "null".into())
            }
            "deals" => {
                let a: Deals = parse_args(args)?;
                to_json(&self.deals(a.category, a.limit).await?)
            }
            "notifications" => {
                let a: Notifs = parse_args(args)?;
                to_json(&self.notifications(a.after, a.limit).await?)
            }
            "mark_read" => {
                let a: UpTo = parse_args(args)?;
                to_json(&self.mark_read(a.up_to).await?)
            }
            "add_push_token" => {
                let a: Token = parse_args(args)?;
                self.add_push_token(a.token).await.map(|()| "null".into())
            }
            "remove_push_token" => {
                let a: Token = parse_args(args)?;
                self.remove_push_token(a.token)
                    .await
                    .map(|()| "null".into())
            }
            other => Err(SdkError::Decode {
                message: format!("unknown operation {other}"),
            }),
        }
    }
}

#[cfg(feature = "http")]
#[uniffi::export]
impl ShopSdk {
    /// The shopping API of the server at `base_url`, logged in with the server's token.
    #[cfg(feature = "http")]
    #[uniffi::constructor]
    pub fn new(base_url: String, token: String) -> Arc<ShopSdk> {
        ShopSdk::with_transport(Arc::new(crate::transport::HttpTransport::new(
            &base_url, &token,
        )))
    }
}
