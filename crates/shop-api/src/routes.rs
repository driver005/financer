//! HTTP handlers. They validate input, call the service, and shape the answer.

use std::collections::{BTreeMap, HashMap};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use financer_shop_core::deals::{DealInfo, Verdict};
use financer_shop_core::{
    compare, AttrValue, CategoryKind, CategorySchema, Comparison, Context, Excluded, Offer,
    ParsedQuery, Picks, Product, Profile, Ranked, Ranker, TierBand, Watch,
};
use financer_shop_sources::IndexRequest;
use financer_shop_store::ShopStoreError;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::jobs::JobView;
use crate::state::{IndexRefusal, ShopState};

const MAX_LIMIT: usize = 100;
const STALE_AFTER_SECS: i64 = 7 * 86_400;

pub enum ShopError {
    BadRequest(String),
    NotFound,
    Invalid(Vec<String>),
    Busy(String),
    Internal,
}

impl From<ShopStoreError> for ShopError {
    fn from(e: ShopStoreError) -> Self {
        tracing::error!("shop store error: {e}");
        ShopError::Internal
    }
}

impl IntoResponse for ShopError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            ShopError::BadRequest(m) => (StatusCode::BAD_REQUEST, json!({ "error": m })),
            ShopError::NotFound => (StatusCode::NOT_FOUND, json!({ "error": "not found" })),
            ShopError::Invalid(problems) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                json!({ "error": problems.join("; "), "problems": problems }),
            ),
            ShopError::Busy(m) => (StatusCode::TOO_MANY_REQUESTS, json!({ "error": m })),
            ShopError::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": "internal error" }),
            ),
        };
        (status, Json(body)).into_response()
    }
}

type Res<T> = Result<Json<T>, ShopError>;

// ---- info and categories -------------------------------------------------------------------------

#[derive(Serialize)]
pub struct Info {
    mode: &'static str,
    continuous: bool,
    products: u64,
    categories: usize,
    sources: Vec<SourceInfo>,
    notifiers: Vec<String>,
    llm: bool,
    watches: usize,
    unread: u64,
    running_jobs: usize,
    last_error: Option<String>,
}

#[derive(Serialize)]
struct SourceInfo {
    name: String,
    kind: financer_shop_sources::Kind,
    category: Option<String>,
}

pub async fn info(State(s): State<ShopState>) -> Res<Info> {
    let reg = s.registry_snapshot();
    Ok(Json(Info {
        mode: if s.config.continuous {
            "server"
        } else {
            "integrated"
        },
        continuous: s.config.continuous,
        products: s.store.count_products(None).await?,
        categories: reg.ids().len(),
        sources: s
            .crawler
            .sources()
            .iter()
            .map(|x| SourceInfo {
                name: x.name.clone(),
                kind: x.kind,
                category: x.category.clone(),
            })
            .collect(),
        notifiers: s.notifiers.iter().map(|n| n.name().to_string()).collect(),
        llm: s.config.llm,
        watches: s.store.list_watches().await?.len(),
        unread: s.store.unread_count().await?,
        running_jobs: s
            .jobs
            .list()
            .iter()
            .filter(|j| !j.progress.phase.finished())
            .count(),
        last_error: s.last_error.lock().expect("error lock").clone(),
    }))
}

#[derive(Serialize)]
pub struct CategoryItem {
    id: String,
    name: String,
    kind: CategoryKind,
    extends: Option<String>,
    builtin: bool,
    customized: bool,
    criteria: usize,
    attributes: usize,
    products: usize,
}

pub async fn list_categories(State(s): State<ShopState>) -> Res<Vec<CategoryItem>> {
    let reg = s.registry_snapshot();
    let builtin = financer_shop_core::Registry::builtin();
    let stored = s.store.stored_schema_ids().await?;
    let snap = s.snapshot().await?;
    let mut out = Vec::new();
    for id in reg.ids() {
        let Ok(r) = reg.resolved(id) else { continue };
        out.push(CategoryItem {
            id: id.to_string(),
            name: r.name.clone(),
            kind: r.kind,
            extends: r.extends.clone(),
            builtin: builtin.raw(id).is_some(),
            customized: stored.iter().any(|x| x == id),
            criteria: r.criteria.len(),
            attributes: r.attributes.len(),
            products: snap.by_category.get(id).map_or(0, Vec::len),
        });
    }
    Ok(Json(out))
}

#[derive(Serialize)]
pub struct CategoryDetail {
    /// With everything it extends merged in: what ranking uses.
    resolved: CategorySchema,
    /// As written: what the editor changes.
    raw: CategorySchema,
    builtin: bool,
    customized: bool,
}

pub async fn get_category(
    State(s): State<ShopState>,
    Path(id): Path<String>,
) -> Res<CategoryDetail> {
    let reg = s.registry_snapshot();
    let (Some(raw), Ok(resolved)) = (reg.raw(&id), reg.resolved(&id)) else {
        return Err(ShopError::NotFound);
    };
    Ok(Json(CategoryDetail {
        resolved,
        raw: raw.clone(),
        builtin: financer_shop_core::Registry::builtin().raw(&id).is_some(),
        customized: s.store.stored_schema_ids().await?.contains(&id),
    }))
}

pub async fn put_category(
    State(s): State<ShopState>,
    Path(id): Path<String>,
    Json(mut schema): Json<CategorySchema>,
) -> Res<CategoryDetail> {
    if schema.id.is_empty() {
        schema.id = id.clone();
    }
    if schema.id != id {
        return Err(ShopError::BadRequest(
            "the id in the body does not match the address".into(),
        ));
    }
    {
        let mut reg = s.registry.write().expect("registry lock");
        let mut trial = reg.clone();
        trial.put(schema.clone()).map_err(|e| match e {
            financer_shop_core::SchemaError::Invalid(p) => ShopError::Invalid(p),
            other => ShopError::Invalid(vec![other.to_string()]),
        })?;
        *reg = trial;
    }
    s.store.put_schema(&schema).await?;
    get_category(State(s), Path(id)).await
}

pub async fn delete_category(
    State(s): State<ShopState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ShopError> {
    if !s.store.delete_schema(&id).await? {
        return Err(if s.registry_snapshot().raw(&id).is_some() {
            ShopError::BadRequest("built-in categories cannot be removed, only changed".into())
        } else {
            ShopError::NotFound
        });
    }
    // back to the built-in version, or gone
    let fresh = s.store.registry().await?;
    *s.registry.write().expect("registry lock") = fresh;
    Ok(StatusCode::NO_CONTENT)
}

// ---- search and compare ------------------------------------------------------------------------

#[derive(Deserialize, Default)]
pub struct SearchRequest {
    #[serde(default)]
    pub query: String,
    pub category: Option<String>,
    pub profile: Option<Profile>,
    pub profile_name: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Serialize)]
pub struct Saving {
    per_month_cents: i64,
    over_horizon_cents: i64,
    current: Option<String>,
}

#[derive(Serialize)]
pub struct SearchItem {
    product: Product,
    ranked: Ranked,
    deal: Option<DealInfo>,
    saving: Option<Saving>,
}

#[derive(Serialize)]
pub struct CatalogueInfo {
    products_in_category: usize,
    newest_offer_at: i64,
    /// Nothing known yet, or nothing newer than a week: the app suggests building the index.
    stale: bool,
}

#[derive(Serialize)]
pub struct SearchResponse {
    category: Option<String>,
    category_guessed: bool,
    parsed: ParsedQuery,
    profile: Profile,
    items: Vec<SearchItem>,
    excluded: Vec<Excluded>,
    picks: Picks,
    tiers: Vec<TierBand>,
    candidates: usize,
    catalogue: CatalogueInfo,
}

/// The person's current plan in a subscription category, to measure savings against.
#[derive(Serialize, Deserialize, Clone)]
pub struct MyPlan {
    pub name: Option<String>,
    pub monthly_cents: i64,
    pub ends_on: Option<String>,
}

async fn base_profile(
    s: &ShopState,
    inline: Option<Profile>,
    name: Option<String>,
) -> Result<Profile, ShopError> {
    match (inline, name) {
        (Some(p), _) => Ok(p),
        (None, Some(n)) => s.store.get_profile(&n).await?.ok_or(ShopError::NotFound),
        (None, None) => Ok(s.store.get_profile("default").await?.unwrap_or_default()),
    }
}

pub async fn search(
    State(s): State<ShopState>,
    Json(req): Json<SearchRequest>,
) -> Res<SearchResponse> {
    let registry = s.registry_snapshot();
    let parsed = ParsedQuery::parse(&req.query, &registry, req.category.as_deref());
    let snap = s.snapshot().await?;

    let (category, guessed) = match &parsed.category {
        Some(c) => (Some(c.clone()), false),
        None => {
            // no category named: the one holding the best matches
            let mut weight: BTreeMap<String, f64> = BTreeMap::new();
            for h in snap.index.search(&parsed.terms, None, 100) {
                if let Some(p) = snap.products.get(&h.id) {
                    *weight.entry(p.category.clone()).or_default() += h.score.max(0.01);
                }
            }
            let best = weight
                .into_iter()
                .max_by(|a, b| a.1.total_cmp(&b.1))
                .map(|(c, _)| c);
            (best, true)
        }
    };

    let mut profile = base_profile(&s, req.profile, req.profile_name).await?;
    profile.constraints.extend(parsed.constraints.clone());
    profile.max_price_cents = match (profile.max_price_cents, parsed.max_price_cents) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    };

    let Some(cat) = category.clone() else {
        return Ok(Json(SearchResponse {
            category: None,
            category_guessed: guessed,
            parsed,
            profile,
            items: vec![],
            excluded: vec![],
            picks: Picks::default(),
            tiers: vec![],
            candidates: 0,
            catalogue: CatalogueInfo {
                products_in_category: 0,
                newest_offer_at: 0,
                stale: true,
            },
        }));
    };
    let schema = registry.resolved(&cat).map_err(|_| ShopError::NotFound)?;
    let universe = snap.category_products(&cat);
    let hits = snap.index.search(&parsed.terms, Some(&cat), 400);
    let candidates: Vec<Product> = hits
        .iter()
        .filter_map(|h| snap.products.get(&h.id).cloned())
        .collect();
    let deals = s.deals_for(&candidates, &profile).await?;
    let ranking = Ranker::rank_in(
        &schema,
        &candidates,
        &universe,
        &profile,
        &Context {
            now: s.now(),
            deals: &deals,
        },
    );

    let my: Option<MyPlan> = match schema.kind {
        CategoryKind::Subscription => s
            .store
            .get_setting(&format!("my:{cat}"))
            .await?
            .and_then(|v| serde_json::from_str(&v).ok()),
        CategoryKind::Product => None,
    };
    let by_id: HashMap<&str, &Product> = candidates.iter().map(|p| (p.id.as_str(), p)).collect();
    let limit = req.limit.unwrap_or(20).clamp(1, MAX_LIMIT);
    let items: Vec<SearchItem> = ranking
        .items
        .iter()
        .take(limit)
        .filter_map(|r| {
            let product = (*by_id.get(r.product_id.as_str())?).clone();
            let saving = my.as_ref().zip(r.price_cents).map(|(m, price)| Saving {
                per_month_cents: m.monthly_cents - price,
                over_horizon_cents: (m.monthly_cents - price) * i64::from(profile.horizon_months),
                current: m.name.clone(),
            });
            Some(SearchItem {
                deal: deals.get(&r.product_id).cloned(),
                product,
                ranked: r.clone(),
                saving,
            })
        })
        .collect();
    let newest = snap.newest_offer(&cat);
    Ok(Json(SearchResponse {
        category,
        category_guessed: guessed,
        parsed,
        profile,
        items,
        excluded: ranking.excluded.into_iter().take(50).collect(),
        picks: ranking.picks,
        tiers: ranking.tiers,
        candidates: candidates.len(),
        catalogue: CatalogueInfo {
            products_in_category: universe.len(),
            newest_offer_at: newest,
            stale: universe.is_empty() || s.now() - newest > STALE_AFTER_SECS,
        },
    }))
}

#[derive(Deserialize)]
pub struct CompareRequest {
    pub product_ids: Vec<String>,
    pub profile: Option<Profile>,
    pub profile_name: Option<String>,
}

pub async fn compare_products(
    State(s): State<ShopState>,
    Json(req): Json<CompareRequest>,
) -> Res<Comparison> {
    if req.product_ids.len() < 2 || req.product_ids.len() > 6 {
        return Err(ShopError::BadRequest("compare 2 to 6 products".into()));
    }
    let snap = s.snapshot().await?;
    let products: Vec<Product> = req
        .product_ids
        .iter()
        .filter_map(|i| snap.products.get(i).cloned())
        .collect();
    if products.len() != req.product_ids.len() {
        return Err(ShopError::NotFound);
    }
    let category = products[0].category.clone();
    if products.iter().any(|p| p.category != category) {
        return Err(ShopError::BadRequest(
            "the products are from different categories".into(),
        ));
    }
    let schema = s
        .registry_snapshot()
        .resolved(&category)
        .map_err(|_| ShopError::NotFound)?;
    let profile = base_profile(&s, req.profile, req.profile_name).await?;
    let deals = s.deals_for(&products, &profile).await?;
    let universe = snap.category_products(&category);
    Ok(Json(compare(
        &schema,
        &products,
        &universe,
        &profile,
        &Context {
            now: s.now(),
            deals: &deals,
        },
    )))
}

// ---- products ---------------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct ListQuery {
    pub category: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

pub async fn list_products(
    State(s): State<ShopState>,
    Query(q): Query<ListQuery>,
) -> Res<Vec<Product>> {
    let snap = s.snapshot().await?;
    let mut ids: Vec<&String> = match &q.category {
        Some(c) => snap
            .by_category
            .get(c)
            .map(|v| v.iter().collect())
            .unwrap_or_default(),
        None => snap.products.keys().collect(),
    };
    ids.sort();
    Ok(Json(
        ids.into_iter()
            .skip(q.offset.unwrap_or(0))
            .take(q.limit.unwrap_or(50).clamp(1, 500))
            .filter_map(|i| snap.products.get(i).cloned())
            .collect(),
    ))
}

#[derive(Serialize)]
pub struct ProductDetail {
    product: Product,
    deal: Option<DealInfo>,
    history: Vec<financer_shop_core::PricePoint>,
    schema: CategorySchema,
}

pub async fn get_product(State(s): State<ShopState>, Path(id): Path<String>) -> Res<ProductDetail> {
    let product = s.store.get_product(&id).await?.ok_or(ShopError::NotFound)?;
    let schema = s
        .registry_snapshot()
        .resolved(&product.category)
        .map_err(|_| ShopError::NotFound)?;
    let profile = Profile::default();
    let deal = s
        .deals_for(std::slice::from_ref(&product), &profile)
        .await?
        .remove(&id);
    let history = s
        .store
        .price_history(&id, s.now() - 2 * crate::state::HISTORY_SECS)
        .await?;
    Ok(Json(ProductDetail {
        product,
        deal,
        history,
        schema,
    }))
}

fn clean_attributes(
    schema: &CategorySchema,
    attrs: BTreeMap<String, AttrValue>,
) -> Result<BTreeMap<String, AttrValue>, ShopError> {
    let mut out = BTreeMap::new();
    for (k, v) in attrs {
        let key = k.trim().to_string();
        if key.is_empty()
            || key.chars().count() > 60
            || !key
                .chars()
                .all(|c| c.is_alphanumeric() || c == '_' || c == '.')
        {
            return Err(ShopError::BadRequest(format!(
                "{k:?} is not a usable attribute key (letters, digits, _ and . only)"
            )));
        }
        if v.to_string().chars().count() > 500 {
            return Err(ShopError::BadRequest(format!(
                "the value of {key} is too long"
            )));
        }
        // "5000 mAh" typed for a number attribute is read the way a shop page would be
        let v = match (schema.attribute(&key), &v) {
            (Some(def), AttrValue::Text(t)) => def.parse(t).unwrap_or(v),
            _ => v,
        };
        out.insert(key, v);
    }
    Ok(out)
}

#[derive(Deserialize, Default)]
pub struct ProductEdit {
    pub title: Option<String>,
    pub brand: Option<String>,
    pub image: Option<String>,
    pub tags: Option<Vec<String>>,
    /// Set or change attributes; `null` removes one.
    #[serde(default)]
    pub attributes: BTreeMap<String, Option<AttrValue>>,
}

pub async fn edit_product(
    State(s): State<ShopState>,
    Path(id): Path<String>,
    Json(edit): Json<ProductEdit>,
) -> Res<Product> {
    let mut product = s.store.get_product(&id).await?.ok_or(ShopError::NotFound)?;
    let schema = s
        .registry_snapshot()
        .resolved(&product.category)
        .map_err(|_| ShopError::NotFound)?;
    if let Some(t) = edit.title {
        if t.trim().is_empty() {
            return Err(ShopError::BadRequest("the title cannot be empty".into()));
        }
        product.title = t.trim().to_string();
    }
    if edit.brand.is_some() {
        product.brand = edit.brand.filter(|b| !b.trim().is_empty());
    }
    if edit.image.is_some() {
        product.image = edit.image.filter(|b| !b.trim().is_empty());
    }
    if let Some(tags) = edit.tags {
        product.tags = tags
            .into_iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
    }
    let (set, remove): (BTreeMap<_, _>, Vec<_>) = edit.attributes.into_iter().fold(
        (BTreeMap::new(), Vec::new()),
        |(mut set, mut rm), (k, v)| {
            match v {
                Some(v) => {
                    set.insert(k, v);
                }
                None => rm.push(k),
            }
            (set, rm)
        },
    );
    for k in remove {
        product.attributes.remove(&k);
    }
    product.attributes.extend(clean_attributes(&schema, set)?);
    s.store.update_product(&product, s.now()).await?;
    Ok(Json(product))
}

#[derive(Deserialize)]
pub struct NewProduct {
    pub category: String,
    pub title: String,
    pub brand: Option<String>,
    pub gtin: Option<String>,
    #[serde(default)]
    pub attributes: BTreeMap<String, AttrValue>,
    #[serde(default)]
    pub offers: Vec<Offer>,
}

pub async fn add_product(
    State(s): State<ShopState>,
    Json(n): Json<NewProduct>,
) -> Result<(StatusCode, Json<Product>), ShopError> {
    let schema = s
        .registry_snapshot()
        .resolved(&n.category)
        .map_err(|_| ShopError::BadRequest(format!("unknown category {:?}", n.category)))?;
    let title = n.title.trim().to_string();
    if title.is_empty() {
        return Err(ShopError::BadRequest("the title cannot be empty".into()));
    }
    let now = s.now();
    let mut attributes = clean_attributes(&schema, n.attributes)?;
    schema.derive_attributes(&title, n.brand.as_deref(), &mut attributes);
    let id = match n.gtin.as_deref() {
        Some(g) if g.chars().filter(char::is_ascii_digit).count() >= 8 => {
            Product::id_for_gtin(&n.category, g)
        }
        _ => Product::make_id(&n.category, n.brand.as_deref(), &title),
    };
    let mut offers = n.offers;
    for o in &mut offers {
        if o.price_cents < 0 || o.recurring.as_ref().is_some_and(|r| r.monthly_cents < 0) {
            return Err(ShopError::BadRequest("prices cannot be negative".into()));
        }
        if o.seen_at == 0 {
            o.seen_at = now;
        }
    }
    let product = Product {
        id,
        category: n.category,
        title,
        brand: n.brand.filter(|b| !b.trim().is_empty()),
        model: None,
        gtin: n.gtin.filter(|g| !g.trim().is_empty()),
        image: None,
        attributes,
        offers,
        tags: vec![],
    };
    s.store.upsert_product(product.clone(), now).await?;
    let saved = s
        .store
        .get_product(&product.id)
        .await?
        .ok_or(ShopError::Internal)?;
    Ok((StatusCode::CREATED, Json(saved)))
}

pub async fn delete_product(
    State(s): State<ShopState>,
    Path(id): Path<String>,
) -> Result<StatusCode, ShopError> {
    if s.store.delete_product(&id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ShopError::NotFound)
    }
}

// ---- profiles and the person's own plans ------------------------------------------------------------

pub async fn list_profiles(State(s): State<ShopState>) -> Res<Vec<serde_json::Value>> {
    Ok(Json(
        s.store
            .list_profiles()
            .await?
            .into_iter()
            .map(|(name, profile)| json!({ "name": name, "profile": profile }))
            .collect(),
    ))
}

pub async fn put_profile(
    State(s): State<ShopState>,
    Path(name): Path<String>,
    Json(p): Json<Profile>,
) -> Res<Profile> {
    if name.trim().is_empty() || name.chars().count() > 60 {
        return Err(ShopError::BadRequest(
            "the name must be 1 to 60 characters".into(),
        ));
    }
    s.store.put_profile(&name, &p).await?;
    Ok(Json(p))
}

pub async fn delete_profile(
    State(s): State<ShopState>,
    Path(name): Path<String>,
) -> Result<StatusCode, ShopError> {
    if s.store.delete_profile(&name).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ShopError::NotFound)
    }
}

pub async fn get_my_plan(
    State(s): State<ShopState>,
    Path(category): Path<String>,
) -> Res<Option<MyPlan>> {
    Ok(Json(
        s.store
            .get_setting(&format!("my:{category}"))
            .await?
            .and_then(|v| serde_json::from_str(&v).ok()),
    ))
}

pub async fn put_my_plan(
    State(s): State<ShopState>,
    Path(category): Path<String>,
    Json(p): Json<MyPlan>,
) -> Res<MyPlan> {
    let reg = s.registry_snapshot();
    match reg.resolved(&category) {
        Ok(c) if c.kind == CategoryKind::Subscription => {}
        _ => {
            return Err(ShopError::BadRequest(
                "only subscription categories have a current plan".into(),
            ))
        }
    }
    if p.monthly_cents < 0 {
        return Err(ShopError::BadRequest(
            "the monthly cost cannot be negative".into(),
        ));
    }
    s.store
        .set_setting(
            &format!("my:{category}"),
            &serde_json::to_string(&p).map_err(|_| ShopError::Internal)?,
        )
        .await?;
    Ok(Json(p))
}

// ---- index jobs -------------------------------------------------------------------------------------

pub async fn start_index(
    State(s): State<ShopState>,
    Json(req): Json<IndexRequest>,
) -> Result<(StatusCode, Json<JobView>), ShopError> {
    if req.query.trim().is_empty() {
        return Err(ShopError::BadRequest("what should be searched for?".into()));
    }
    if s.crawler.sources().is_empty() {
        return Err(ShopError::Invalid(vec![
            "no shop sources are configured, so there is nothing to read; add some in the settings"
                .into(),
        ]));
    }
    match s.start_index(req) {
        Ok(job) => Ok((StatusCode::ACCEPTED, Json(job.view()))),
        Err(IndexRefusal::Busy) => Err(ShopError::Busy(
            "other searches are still being indexed; try again in a moment".into(),
        )),
    }
}

pub async fn get_index(State(s): State<ShopState>, Path(id): Path<String>) -> Res<JobView> {
    s.jobs
        .get(&id)
        .map(|j| Json(j.view()))
        .ok_or(ShopError::NotFound)
}

pub async fn cancel_index(State(s): State<ShopState>, Path(id): Path<String>) -> Res<JobView> {
    let job = s.jobs.get(&id).ok_or(ShopError::NotFound)?;
    job.cancel.cancel();
    Ok(Json(job.view()))
}

pub async fn list_index(State(s): State<ShopState>) -> Res<Vec<JobView>> {
    Ok(Json(s.jobs.list()))
}

// ---- watches, deals, notifications ----------------------------------------------------------------------

pub async fn list_watches(State(s): State<ShopState>) -> Res<Vec<Watch>> {
    Ok(Json(s.store.list_watches().await?))
}

fn check_watch(w: &Watch) -> Result<(), ShopError> {
    if w.name.trim().is_empty() {
        return Err(ShopError::BadRequest("give the watch a name".into()));
    }
    if w.query.as_deref().is_none_or(|q| q.trim().is_empty()) && w.product_ids.is_empty() {
        return Err(ShopError::BadRequest(
            "a watch needs a search or products".into(),
        ));
    }
    if w.max_price_cents.is_none() && w.min_discount_pct.is_none() {
        return Err(ShopError::BadRequest(
            "say when to tell you: a price at or below, or a discount of at least".into(),
        ));
    }
    Ok(())
}

pub async fn create_watch(
    State(s): State<ShopState>,
    Json(w): Json<Watch>,
) -> Result<(StatusCode, Json<Watch>), ShopError> {
    check_watch(&w)?;
    let saved = s.store.create_watch(&w).await?;
    // a deal that already exists is announced now, not at the next crawl
    let _ = s.check_watches().await;
    Ok((StatusCode::CREATED, Json(saved)))
}

pub async fn update_watch(
    State(s): State<ShopState>,
    Path(id): Path<i64>,
    Json(mut w): Json<Watch>,
) -> Res<Watch> {
    check_watch(&w)?;
    w.id = id;
    if s.store.update_watch(&w).await? {
        Ok(Json(w))
    } else {
        Err(ShopError::NotFound)
    }
}

pub async fn delete_watch(
    State(s): State<ShopState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ShopError> {
    if s.store.delete_watch(id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ShopError::NotFound)
    }
}

#[derive(Deserialize)]
pub struct DealsQuery {
    pub category: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Serialize)]
pub struct DealItem {
    product: Product,
    deal: DealInfo,
}

pub async fn deals(State(s): State<ShopState>, Query(q): Query<DealsQuery>) -> Res<Vec<DealItem>> {
    let snap = s.snapshot().await?;
    let products: Vec<Product> = match &q.category {
        Some(c) => snap.category_products(c),
        None => snap.products.values().cloned().collect(),
    };
    let info = s.deals_for(&products, &Profile::default()).await?;
    let mut items: Vec<DealItem> = products
        .into_iter()
        .filter_map(|p| {
            let deal = info
                .get(&p.id)
                .filter(|d| d.verdict >= Verdict::Good)?
                .clone();
            Some(DealItem { product: p, deal })
        })
        .collect();
    items.sort_by(|a, b| {
        b.deal
            .discount_pct
            .total_cmp(&a.deal.discount_pct)
            .then(a.product.id.cmp(&b.product.id))
    });
    items.truncate(q.limit.unwrap_or(30).clamp(1, MAX_LIMIT));
    Ok(Json(items))
}

#[derive(Deserialize)]
pub struct NotificationsQuery {
    pub after: Option<i64>,
    pub limit: Option<u64>,
}

#[derive(Serialize)]
pub struct NotificationItem {
    id: i64,
    created_at: i64,
    read: bool,
    message: String,
    event: financer_shop_core::DealEvent,
}

#[derive(Serialize)]
pub struct Notifications {
    items: Vec<NotificationItem>,
    unread: u64,
    last_id: i64,
}

pub async fn notifications(
    State(s): State<ShopState>,
    Query(q): Query<NotificationsQuery>,
) -> Res<Notifications> {
    let after = q.after.unwrap_or(0);
    let rows = s
        .store
        .events_after(after, q.limit.unwrap_or(50).clamp(1, 200))
        .await?;
    let last_id = rows.last().map_or(after, |r| r.id);
    Ok(Json(Notifications {
        items: rows
            .into_iter()
            .map(|r| NotificationItem {
                id: r.id,
                created_at: r.created_at,
                read: r.read_at.is_some(),
                message: r.event.message(),
                event: r.event,
            })
            .collect(),
        unread: s.store.unread_count().await?,
        last_id,
    }))
}

#[derive(Deserialize)]
pub struct ReadRequest {
    pub up_to: i64,
}

pub async fn mark_read(
    State(s): State<ShopState>,
    Json(r): Json<ReadRequest>,
) -> Res<serde_json::Value> {
    let n = s.store.mark_read(r.up_to, s.now()).await?;
    Ok(Json(
        json!({ "marked": n, "unread": s.store.unread_count().await? }),
    ))
}

#[derive(Deserialize)]
pub struct TokenBody {
    pub token: String,
}

pub async fn add_push_token(
    State(s): State<ShopState>,
    Json(t): Json<TokenBody>,
) -> Result<StatusCode, ShopError> {
    let ok = (t.token.starts_with("ExponentPushToken[") || t.token.starts_with("ExpoPushToken["))
        && t.token.ends_with(']')
        && t.token.len() < 200;
    if !ok {
        return Err(ShopError::BadRequest("not an Expo push token".into()));
    }
    s.store.add_push_token(&t.token, s.now()).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove_push_token(
    State(s): State<ShopState>,
    Json(t): Json<TokenBody>,
) -> Result<StatusCode, ShopError> {
    s.store.remove_push_token(&t.token).await?;
    Ok(StatusCode::NO_CONTENT)
}
