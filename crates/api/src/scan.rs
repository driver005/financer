//! Barcode lookup: what a scanned product costs at each chain.

use axum::extract::{Path, State};
use axum::Json;
use financer_core::{Catalog, Chain, Money, Unit};
use financer_prices::off::{OpenFoodFacts, OpenPrice};
use financer_prices::{
    Basis, ChainRanker, Ean, Keys, Normalizer, PackSize, RawOffer, SourceConfig,
};
use serde::Serialize;
use time::{Date, Duration, OffsetDateTime};
use utoipa::ToSchema;

use crate::dto::ErrorBody;
use crate::routes::ApiError;
use crate::AppState;

/// Observations shown at most.
const MAX_OBSERVATIONS: usize = 10;
/// Default window for Open Prices observations when no source says otherwise.
const DEFAULT_MAX_AGE_DAYS: i64 = 60;

/// The best known price of the scanned product at one chain.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ChainPriceDto {
    #[schema(value_type = String, example = "lidl")]
    pub chain: Chain,
    /// `product`: a shelf price seen for exactly this barcode. `item`: the cheapest stored price
    /// for the catalog item (for example milk), per reference pack; not necessarily this brand.
    pub scope: String,
    /// Shelf price of the scanned pack for scope `product`, price of the reference pack for
    /// scope `item`.
    #[schema(value_type = i64)]
    pub price_cents: Money,
    /// Pack the price is for, for example `500 g` (scope `item`: the reference pack).
    pub pack: Option<String>,
    /// Price of one kg or l in cents, where the pack size is known.
    pub unit_price_cents: Option<i64>,
    /// `kg` or `l`.
    pub unit: Option<String>,
    pub is_offer: bool,
    #[schema(value_type = Option<String>, format = Date)]
    pub valid_until: Option<Date>,
    /// Day the price was seen (Open Prices), if known.
    #[schema(value_type = Option<String>, format = Date)]
    pub observed_on: Option<Date>,
    pub product_name: Option<String>,
    /// `open-prices` for a live observation, or the name of the stored price source.
    pub source: String,
}

/// A crowdsourced Open Prices observation.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ObservationDto {
    #[schema(value_type = i64)]
    pub price_cents: Money,
    #[schema(value_type = String, format = Date)]
    pub date: Date,
    /// Store name as recorded, if any.
    pub store: Option<String>,
    /// Lidl, Aldi, Kaufland or Rewe when the store is one of them.
    #[schema(value_type = Option<String>, example = "rewe")]
    pub chain: Option<Chain>,
    pub unit_price_cents: Option<i64>,
    /// `kg` or `l`, with `unit_price_cents`.
    pub unit: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EanLookupDto {
    /// The barcode in the form used by Open Prices (UPC-A gets a leading 0).
    pub ean: String,
    /// `ean8`, `upc_a` or `ean13`.
    pub kind: String,
    pub product_name: Option<String>,
    /// Pack size as printed, for example `500 g`.
    pub pack: Option<String>,
    /// Catalog key (see `GET /v1/catalog`), when the product is a known kind of item; usable in
    /// the usual items (`PUT /v1/basket`).
    pub item: Option<String>,
    pub item_name: Option<String>,
    pub reference_pack: Option<String>,
    /// One entry per chain with a known price, cheapest first.
    pub chains: Vec<ChainPriceDto>,
    /// What the chains were compared on: `unit_price`, `reference_pack` or `pack_price`;
    /// absent when their prices have nothing in common.
    pub compared_by: Option<String>,
    /// The cheapest chain; absent on a tie, or when the chains cannot be compared.
    #[schema(value_type = Option<String>, example = "aldi")]
    pub cheapest: Option<Chain>,
    /// Chains sharing the lowest price when there is a tie.
    #[schema(value_type = Vec<String>)]
    pub tied_cheapest: Vec<Chain>,
    /// Recent Open Prices observations, newest first.
    pub observations: Vec<ObservationDto>,
    /// True when Open Prices answered for this request.
    pub live_lookup: bool,
    /// Plain-language remarks: what is missing and why.
    pub notes: Vec<String>,
}

/// Open Prices settings gathered from the configured sources.
struct OpenPricesConfig {
    barcodes: Vec<(String, String)>,
    max_age_days: i64,
}

impl OpenPricesConfig {
    fn from_sources(sources: &[SourceConfig]) -> Option<Self> {
        let mut found = false;
        let mut barcodes = Vec::new();
        let mut max_age_days = 0;
        for s in sources {
            if let SourceConfig::OpenPrices {
                items,
                max_age_days: age,
            } = s
            {
                found = true;
                max_age_days = max_age_days.max(*age);
                barcodes.extend(items.iter().map(|i| (i.item.clone(), i.barcode.clone())));
            }
        }
        found.then_some(Self {
            barcodes,
            max_age_days: if max_age_days > 0 {
                max_age_days
            } else {
                DEFAULT_MAX_AGE_DAYS
            },
        })
    }
}

fn unit_name(unit: Unit) -> Option<&'static str> {
    match unit {
        Unit::Kilogram => Some("kg"),
        Unit::Liter => Some("l"),
        Unit::Piece => None,
    }
}

/// The scan lookup behind `GET /v1/prices/ean/{ean}`.
pub struct Scan;

impl Scan {
    /// What Open Prices knows about the barcode right now. Failures are reported as a note,
    /// never as an error: the stored prices are still worth showing.
    async fn observations(
        state: &AppState,
        ean: &Ean,
        notes: &mut Vec<String>,
    ) -> Option<Vec<OpenPrice>> {
        match state
            .http
            .get(&OpenFoodFacts::open_prices_url(&ean.canonical()))
            .await
        {
            Ok(res) if res.status < 400 => Some(
                OpenFoodFacts::parse_open_prices(&res.body)
                    .into_iter()
                    .filter(|p| ean.is_same_product(&p.product_code))
                    .collect(),
            ),
            Ok(res) => {
                notes.push(format!(
                    "Open Prices answered {}; showing stored prices only.",
                    res.status
                ));
                None
            }
            Err(e) => {
                notes.push(format!(
                    "Open Prices could not be reached ({e}); showing stored prices only."
                ));
                None
            }
        }
    }

    pub async fn lookup(
        State(state): State<AppState>,
        Path(code): Path<String>,
    ) -> Result<Json<EanLookupDto>, ApiError> {
        let ean = Ean::parse(&code).map_err(|e| ApiError::BadRequest(e.to_string()))?;
        let today = OffsetDateTime::now_utc().date();
        let mut notes = Vec::new();

        let config = OpenPricesConfig::from_sources(&state.price_sources);
        let configured_item = config.as_ref().and_then(|c| {
            c.barcodes
                .iter()
                .find(|(_, barcode)| ean.is_same_product(barcode))
                .map(|(item, _)| item.clone())
        });

        // recent crowdsourced observations, only when the person set up Open Prices
        let mut live_lookup = false;
        let mut observed = Vec::new();
        match &config {
            Some(cfg) => {
                if let Some(found) = Self::observations(&state, &ean, &mut notes).await {
                    live_lookup = true;
                    let oldest = today - Duration::days(cfg.max_age_days);
                    observed = found
                        .into_iter()
                        .filter(|p| p.date >= oldest && p.date <= today + Duration::days(1))
                        .collect();
                    observed.sort_by(|a, b| b.date.cmp(&a.date).then(a.price.cmp(&b.price)));
                }
            }
            None => notes.push(
                "No Open Prices source is configured, so only stored prices can be shown \
                 (see docs/PRICES.md)."
                    .into(),
            ),
        }

        let product_name = observed.iter().find_map(|p| p.product_name.clone());
        let pack = observed.iter().find_map(|p| p.pack.clone());
        let item = configured_item
            .as_deref()
            .and_then(Catalog::by_key)
            .or_else(|| product_name.as_deref().and_then(Catalog::match_product));
        let pack_size = pack
            .as_deref()
            .and_then(PackSize::parse)
            .or_else(|| product_name.as_deref().and_then(PackSize::parse));

        let mut candidates: Vec<(Chain, Keys, ChainPriceDto)> = Vec::new();

        // stored prices for the catalog item (still valid today)
        let mut stored_name = None;
        if let Some(item) = item {
            let reference_milli = u64::from(Catalog::reference_milli(item.key));
            for q in state.store.list_quotes().await? {
                if q.quote.item != item.key || q.quote.valid_until.is_some_and(|d| d < today) {
                    continue;
                }
                if q.source == "open-prices" && configured_item.is_some() {
                    // stored from this barcode's observations; when the live lookup just read
                    // them, those are fresher
                    if live_lookup {
                        continue;
                    }
                    stored_name.get_or_insert_with(|| q.product_name.clone());
                }
                let cents = q.quote.price.cents();
                let unit_price = PackSize::per_kg_or_l(item.unit, reference_milli, cents);
                candidates.push((
                    q.quote.chain,
                    Keys {
                        unit: unit_price,
                        reference: Some(cents),
                        pack: None,
                    },
                    ChainPriceDto {
                        chain: q.quote.chain,
                        scope: "item".into(),
                        price_cents: q.quote.price,
                        pack: Catalog::reference_label(item.key),
                        unit_price_cents: unit_price,
                        unit: unit_name(item.unit).map(str::to_string),
                        is_offer: q.quote.is_offer,
                        valid_until: q.quote.valid_until,
                        observed_on: None,
                        product_name: Some(q.product_name),
                        source: q.source,
                    },
                ));
            }
        }

        // newest observation per chain: the price this exact product had on the shelf
        let mut seen = std::collections::BTreeSet::new();
        for p in &observed {
            let Some(chain) = p.store.as_deref().and_then(Chain::from_name) else {
                continue;
            };
            if !seen.insert(chain) {
                continue;
            }
            let unit_price = pack_size.and_then(|s| s.unit_price_cents(p.price.cents()));
            let reference = item.and_then(|it| {
                Normalizer::normalize(&RawOffer {
                    chain,
                    name: product_name.clone().unwrap_or_default(),
                    price: p.price,
                    pack_text: pack.clone(),
                    valid_until: None,
                    is_offer: false,
                    source: "open-prices".into(),
                    item_hint: Some(it.key.to_string()),
                })
                .ok()
                .map(|d| d.quote.price.cents())
            });
            candidates.push((
                chain,
                Keys {
                    unit: unit_price,
                    reference,
                    pack: Some(p.price.cents()),
                },
                ChainPriceDto {
                    chain,
                    scope: "product".into(),
                    price_cents: p.price,
                    pack: pack.clone(),
                    unit_price_cents: unit_price,
                    unit: pack_size
                        .and_then(|s| unit_name(s.unit))
                        .map(str::to_string),
                    is_offer: false,
                    valid_until: None,
                    observed_on: Some(p.date),
                    product_name: product_name.clone(),
                    source: "open-prices".into(),
                },
            ));
        }

        let ranking = ChainRanker::rank(candidates);
        let chains: Vec<ChainPriceDto> = ranking.entries.into_iter().map(|(_, d)| d).collect();
        let (cheapest, tied_cheapest) = match ranking.cheapest.as_slice() {
            [one] => (Some(*one), Vec::new()),
            many => (None, many.to_vec()),
        };

        if chains.iter().any(|c| c.scope == "item") {
            notes.push(
                "Prices marked as item are the cheapest stored price for the kind of product \
                 (per reference pack), not necessarily this brand."
                    .into(),
            );
        }
        if chains.len() > 1 && ranking.basis.is_none() {
            notes.push(
                "The chains' prices are not comparable (different pack sizes or sources), so \
                 no cheapest chain is named."
                    .into(),
            );
        }
        if chains.is_empty() {
            notes.push(if live_lookup && observed.is_empty() {
                "No recent price for this barcode at Lidl, Aldi, Kaufland or Rewe is stored or on \
                 Open Prices."
                    .into()
            } else {
                "No stored price for this barcode. Add it to an open_prices source in \
                 FINANCER_PRICE_SOURCES and refresh prices to track it."
                    .into()
            });
        }

        Ok(Json(EanLookupDto {
            ean: ean.canonical(),
            kind: ean.kind().as_str().to_string(),
            product_name: product_name.or(stored_name),
            pack,
            item: item.map(|i| i.key.to_string()),
            item_name: item.map(|i| i.name_de.to_string()),
            reference_pack: item.and_then(|i| Catalog::reference_label(i.key)),
            chains,
            compared_by: ranking.basis.map(|b| {
                match b {
                    Basis::Unit => "unit_price",
                    Basis::Reference => "reference_pack",
                    Basis::Pack => "pack_price",
                }
                .to_string()
            }),
            cheapest,
            tied_cheapest,
            observations: observed
                .iter()
                .take(MAX_OBSERVATIONS)
                .map(|p| ObservationDto {
                    price_cents: p.price,
                    date: p.date,
                    store: p.store.clone(),
                    chain: p.store.as_deref().and_then(Chain::from_name),
                    unit_price_cents: pack_size.and_then(|s| s.unit_price_cents(p.price.cents())),
                    unit: pack_size
                        .and_then(|s| unit_name(s.unit))
                        .map(str::to_string),
                })
                .collect(),
            live_lookup,
            notes,
        }))
    }
}

/// What a scanned barcode costs at Lidl, Aldi, Kaufland and Rewe: the best stored price per
/// chain, recent Open Prices observations, unit prices and the cheapest chain. A valid barcode
/// nobody has a price for answers `200` with no chains and a note.
#[utoipa::path(get, path = "/v1/prices/ean/{ean}",
    params(("ean" = String, Path, description = "EAN-8, EAN-13 or UPC-A, with a valid check digit")),
    responses(
        (status = 200, body = EanLookupDto),
        (status = 400, description = "Not a valid barcode (digits, length or check digit)", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn ean_lookup(
    State(state): State<AppState>,
    Path(ean): Path<String>,
) -> Result<Json<EanLookupDto>, ApiError> {
    Scan::lookup(State(state), Path(ean)).await
}
