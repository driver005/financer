//! Ranking: judge every product by the criteria of its category, weighted by what the person
//! cares about, and explain the result.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::deals::DealInfo;
use crate::product::{Condition, Product, DEFAULT_HORIZON_MONTHS};
use crate::schema::{CategorySchema, CriterionDef, CriterionKind, Missing, Scale};
use crate::value::{fmt_num, AttrValue};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Op {
    Gte,
    Lte,
    Eq,
    Ne,
    /// A text or list attribute contains the word.
    Contains,
    /// The attribute is one of the listed values.
    AnyOf,
}

/// A hard requirement: products that fail it are left out (and listed with the reason).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Constraint {
    /// An attribute key, or `price`, `brand`, `title`.
    pub attribute: String,
    pub op: Op,
    pub value: AttrValue,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Preference {
    #[serde(default)]
    pub prefer: Vec<String>,
    #[serde(default)]
    pub avoid: Vec<String>,
}

/// What this person wants. Every field is optional; the default is "the category's own weights".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Profile {
    /// Criterion key to importance, overriding the category's default. 0 switches it off.
    #[serde(default)]
    pub weights: BTreeMap<String, f64>,
    #[serde(default)]
    pub constraints: Vec<Constraint>,
    /// Soft wishes by name, e.g. `ecosystem: {prefer: ["apple"]}` or `network: {prefer: ["telekom"]}`.
    #[serde(default)]
    pub preferences: BTreeMap<String, Preference>,
    /// Comparable price ceiling: the total for purchases, the monthly cost for plans.
    #[serde(default)]
    pub max_price_cents: Option<i64>,
    /// Months a plan is compared over.
    #[serde(default = "horizon")]
    pub horizon_months: u32,
    /// Offer conditions accepted; empty means any.
    #[serde(default = "new_only")]
    pub conditions: Vec<Condition>,
    #[serde(default = "yes")]
    pub in_stock_only: bool,
    #[serde(default)]
    pub exclude_brands: Vec<String>,
    /// Criteria added just for this profile, on top of the category's own.
    #[serde(default)]
    pub extra_criteria: Vec<CriterionDef>,
}

fn horizon() -> u32 {
    DEFAULT_HORIZON_MONTHS
}
fn new_only() -> Vec<Condition> {
    vec![Condition::New]
}
fn yes() -> bool {
    true
}

impl Default for Profile {
    fn default() -> Self {
        Profile {
            weights: BTreeMap::new(),
            constraints: Vec::new(),
            preferences: BTreeMap::new(),
            max_price_cents: None,
            horizon_months: horizon(),
            conditions: new_only(),
            in_stock_only: true,
            exclude_brands: Vec::new(),
            extra_criteria: Vec::new(),
        }
    }
}

/// What the ranking needs besides products and profile.
#[derive(Debug, Clone, Copy)]
pub struct Context<'a> {
    /// Unix seconds; the clock for "newness" criteria.
    pub now: i64,
    pub deals: &'a BTreeMap<String, DealInfo>,
}

static NO_DEALS: BTreeMap<String, DealInfo> = BTreeMap::new();

impl Context<'static> {
    pub fn at(now: i64) -> Context<'static> {
        Context {
            now,
            deals: &NO_DEALS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CriterionScore {
    pub key: String,
    pub label: String,
    pub group: Option<String>,
    pub weight: f64,
    /// The measured value as text (`5000 mAh`, `yes`).
    pub value: Option<String>,
    /// 0..1, `None` when unknown.
    pub score: Option<f64>,
    /// Points this criterion adds to the 0..100 total.
    pub points: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ranked {
    pub product_id: String,
    pub score: f64,
    /// Share of the total weight that could be judged (1 = every criterion known).
    pub confidence: f64,
    /// The score without price and deal criteria.
    pub quality: Option<f64>,
    /// Quality per price (see [`Ranker`] docs).
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Excluded {
    pub product_id: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Picks {
    /// Highest overall score.
    pub best_overall: Option<String>,
    /// Most quality for the money.
    pub best_value: Option<String>,
    /// Cheapest among the better half.
    pub cheapest_good: Option<String>,
    /// Highest quality whatever it costs.
    pub premium: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TierBand {
    pub label: String,
    pub from_cents: i64,
    pub to_cents: i64,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ranking {
    pub category: String,
    pub items: Vec<Ranked>,
    pub excluded: Vec<Excluded>,
    pub picks: Picks,
    pub tiers: Vec<TierBand>,
}

/// Scores products. The overall score is the weighted mean of the criteria scores that are
/// known, times 100. *Quality* is the same without the price and deal criteria, and the
/// *value index* is quality divided by the square root of the price relative to the median:
/// twice the price must buy about 41 % more quality to be worth it.
pub struct Ranker;

struct Column<'a> {
    def: &'a CriterionDef,
    weight: f64,
    /// Score and display text per product index.
    cells: Vec<(Option<f64>, Option<String>)>,
    applicable: bool,
}

impl Ranker {
    pub fn rank(
        schema: &CategorySchema,
        products: &[Product],
        profile: &Profile,
        ctx: &Context<'_>,
    ) -> Ranking {
        let criteria = Self::criteria(schema, profile);
        let offers: Vec<Option<BestOffer>> = products
            .iter()
            .map(|p| Self::best_offer(p, profile))
            .collect();

        let mut columns: Vec<Column<'_>> = criteria
            .iter()
            .map(|(def, weight)| {
                Self::column(schema, def, *weight, products, &offers, profile, ctx)
            })
            .collect();

        // what a missing value counts as
        for col in &mut columns {
            for cell in &mut col.cells {
                if cell.0.is_none() && col.applicable {
                    match col.def.missing {
                        Missing::Skip => {}
                        Missing::Neutral => cell.0 = Some(0.5),
                        Missing::Worst => cell.0 = Some(0.0),
                    }
                }
            }
        }

        let tiers = Self::tiers(schema, products, &offers);
        let median_price = Self::median_price(&offers);

        let mut items = Vec::new();
        let mut excluded = Vec::new();
        for (i, product) in products.iter().enumerate() {
            let reasons = Self::exclusions(product, offers[i].as_ref(), profile);
            if !reasons.is_empty() {
                excluded.push(Excluded {
                    product_id: product.id.clone(),
                    reasons,
                });
                continue;
            }
            items.push(Self::score_product(
                product,
                i,
                &columns,
                offers[i].as_ref(),
                median_price,
                &tiers,
            ));
        }
        items.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then(
                    a.price_cents
                        .unwrap_or(i64::MAX)
                        .cmp(&b.price_cents.unwrap_or(i64::MAX)),
                )
                .then(a.product_id.cmp(&b.product_id))
        });
        Self::mark_frontier(&mut items);
        let picks = Self::picks(&items);
        Ranking {
            category: schema.id.clone(),
            items,
            excluded,
            picks,
            tiers: Self::bands(schema, &tiers),
        }
    }

    /// The category's criteria with the profile's extras and weights applied.
    fn criteria<'a>(
        schema: &'a CategorySchema,
        profile: &'a Profile,
    ) -> Vec<(&'a CriterionDef, f64)> {
        let mut out: Vec<(&CriterionDef, f64)> = Vec::new();
        for def in schema
            .criteria
            .iter()
            .filter(|c| !profile.extra_criteria.iter().any(|e| e.key == c.key))
            .chain(profile.extra_criteria.iter())
        {
            let weight = profile.weights.get(&def.key).copied().unwrap_or(def.weight);
            out.push((
                def,
                if weight.is_finite() {
                    weight.max(0.0)
                } else {
                    0.0
                },
            ));
        }
        out
    }

    fn best_offer(product: &Product, profile: &Profile) -> Option<BestOffer> {
        let offer = product
            .usable_offers(
                &profile.conditions,
                profile.in_stock_only,
                profile.horizon_months,
            )
            .into_iter()
            .next()?;
        let h = profile.horizon_months;
        Some(BestOffer {
            comparable_cents: offer.comparable_cents(h),
            monthly_cents: offer.effective_monthly_cents(h),
            upfront_cents: offer.price_cents + offer.shipping_cents,
            term_months: offer.recurring.as_ref().map_or(0, |r| r.min_term_months),
            discount_pct: offer.discount_pct(),
            shop: offer.shop.clone(),
            url: offer.url.clone(),
        })
    }

    fn numeric_vars(product: &Product, best: Option<&BestOffer>) -> BTreeMap<String, f64> {
        let mut vars: BTreeMap<String, f64> = product
            .attributes
            .iter()
            .filter(|(_, v)| {
                !matches!(v, AttrValue::Text(_) | AttrValue::List(_)) || v.as_f64().is_some()
            })
            .filter_map(|(k, v)| v.as_f64().map(|n| (k.clone(), n)))
            .collect();
        if let Some(b) = best {
            vars.insert("price".into(), b.comparable_cents as f64 / 100.0);
            vars.insert("upfront".into(), b.upfront_cents as f64 / 100.0);
            vars.insert("term_months".into(), f64::from(b.term_months));
            if let Some(m) = b.monthly_cents {
                vars.insert("monthly".into(), m as f64 / 100.0);
            }
        }
        vars
    }

    fn column<'a>(
        schema: &CategorySchema,
        def: &'a CriterionDef,
        weight: f64,
        products: &[Product],
        offers: &[Option<BestOffer>],
        profile: &Profile,
        ctx: &Context<'_>,
    ) -> Column<'a> {
        let mut applicable = true;
        let attr_text = |p: &Product, key: &str| -> Option<String> {
            let v = p.attributes.get(key)?;
            Some(match schema.attribute(key) {
                Some(d) => d.display(v),
                None => v.to_string(),
            })
        };
        // raw numbers for scaled kinds, finished scores for direct kinds
        let mut raws: Vec<Option<f64>> = Vec::with_capacity(products.len());
        let mut texts: Vec<Option<String>> = Vec::with_capacity(products.len());
        let mut direct: Vec<Option<f64>> = Vec::with_capacity(products.len());
        let formula = match &def.source {
            CriterionKind::Formula { expr } => crate::formula::Formula::parse(expr).ok(),
            _ => None,
        };
        for (i, p) in products.iter().enumerate() {
            let best = offers[i].as_ref();
            let (raw, text, dir): (Option<f64>, Option<String>, Option<f64>) = match &def.source {
                CriterionKind::Number { attribute } => (
                    p.attributes.get(attribute).and_then(AttrValue::as_f64),
                    attr_text(p, attribute),
                    None,
                ),
                CriterionKind::Formula { .. } => {
                    let v = formula
                        .as_ref()
                        .and_then(|f| f.eval(&Self::numeric_vars(p, best)));
                    (v, v.map(fmt_num), None)
                }
                CriterionKind::Price => {
                    let v = best.map(|b| b.comparable_cents as f64 / 100.0);
                    let suffix = if best.is_some_and(|b| b.monthly_cents.is_some()) {
                        "/month"
                    } else {
                        ""
                    };
                    (v, v.map(|x| format!("{x:.2} EUR{suffix}")), None)
                }
                CriterionKind::Deal => {
                    let v = best.map(|b| {
                        ctx.deals
                            .get(&p.id)
                            .map(|d| d.discount_pct)
                            .or(b.discount_pct)
                            .unwrap_or(0.0)
                    });
                    (v, v.map(|x| format!("{x:.0} % below usual")), None)
                }
                CriterionKind::Flag { attribute } => {
                    let v = p.attributes.get(attribute).and_then(AttrValue::as_bool);
                    (
                        None,
                        v.map(|b| if b { "yes".into() } else { "no".into() }),
                        v.map(|b| f64::from(u8::from(b))),
                    )
                }
                CriterionKind::Choice {
                    attribute,
                    scores,
                    default,
                } => {
                    let text = attr_text(p, attribute);
                    let tokens: Vec<String> = p
                        .attributes
                        .get(attribute)
                        .map(AttrValue::tokens)
                        .unwrap_or_default();
                    let score = if tokens.is_empty() {
                        None
                    } else {
                        tokens
                            .iter()
                            .flat_map(|t| {
                                scores
                                    .iter()
                                    .filter(move |(k, _)| t.contains(&k.to_lowercase()))
                                    .map(|(_, s)| *s)
                            })
                            .fold(None, |acc: Option<f64>, s| {
                                Some(acc.map_or(s, |a| a.max(s)))
                            })
                            .or(*default)
                    };
                    (None, text, score)
                }
                CriterionKind::Match {
                    attribute,
                    preference,
                } => {
                    match profile
                        .preferences
                        .get(preference)
                        .filter(|p| !p.prefer.is_empty() || !p.avoid.is_empty())
                    {
                        None => {
                            applicable = false;
                            (None, None, None)
                        }
                        Some(pref) => {
                            let tokens: Vec<String> = p
                                .attributes
                                .get(attribute)
                                .map(AttrValue::tokens)
                                .unwrap_or_default();
                            let has = |list: &[String]| {
                                list.iter()
                                    .any(|w| tokens.iter().any(|t| *t == w.trim().to_lowercase()))
                            };
                            let score = if tokens.is_empty() {
                                None
                            } else if has(&pref.avoid) {
                                Some(0.0)
                            } else if has(&pref.prefer) {
                                Some(1.0)
                            } else {
                                Some(0.4)
                            };
                            (None, attr_text(p, attribute), score)
                        }
                    }
                }
                CriterionKind::Age {
                    attribute,
                    half_life_months,
                } => {
                    let released = p.attributes.get(attribute).map(AttrValue::to_string);
                    let score = released.as_deref().and_then(month_index).map(|m| {
                        let age = (now_month(ctx.now) - m).max(0.0);
                        0.5f64.powf(age / half_life_months)
                    });
                    (None, released, score)
                }
            };
            raws.push(if def.log {
                raw.filter(|v| *v > 0.0).map(f64::ln)
            } else {
                raw
            });
            texts.push(text);
            direct.push(dir);
        }

        let scores: Vec<Option<f64>> = if def.is_direct() {
            direct
        } else {
            Self::scale(def, &raws)
        };
        Column {
            def,
            weight,
            cells: scores.into_iter().zip(texts).collect(),
            applicable,
        }
    }

    fn scale(def: &CriterionDef, raws: &[Option<f64>]) -> Vec<Option<f64>> {
        let known: Vec<f64> = raws.iter().flatten().copied().collect();
        let flip = |s: f64| if def.higher_is_better() { s } else { 1.0 - s };
        let ln = |v: f64| {
            if def.log {
                v.max(f64::MIN_POSITIVE).ln()
            } else {
                v
            }
        };
        raws.iter()
            .map(|r| {
                let v = (*r)?;
                let s = match &def.scale {
                    Scale::Fixed { min, max } => {
                        let (lo, hi) = (ln(*min), ln(*max));
                        ((v - lo) / (hi - lo)).clamp(0.0, 1.0)
                    }
                    Scale::Minmax => {
                        let lo = known.iter().copied().fold(f64::INFINITY, f64::min);
                        let hi = known.iter().copied().fold(f64::NEG_INFINITY, f64::max);
                        if hi > lo {
                            (v - lo) / (hi - lo)
                        } else {
                            0.5
                        }
                    }
                    Scale::Percentile => {
                        if known.len() < 2 {
                            0.5
                        } else {
                            let less = known.iter().filter(|x| **x < v).count() as f64;
                            let equal = known.iter().filter(|x| **x == v).count() as f64;
                            (less + 0.5 * (equal - 1.0)) / (known.len() as f64 - 1.0)
                        }
                    }
                };
                Some(flip(s))
            })
            .collect()
    }

    fn score_product(
        product: &Product,
        index: usize,
        columns: &[Column<'_>],
        best: Option<&BestOffer>,
        median_price: Option<f64>,
        tiers: &Tiers,
    ) -> Ranked {
        let total_weight: f64 = columns
            .iter()
            .filter(|c| c.applicable)
            .map(|c| c.weight)
            .sum();
        let mut known_weight = 0.0;
        let mut weighted = 0.0;
        let mut q_known = 0.0;
        let mut q_weighted = 0.0;
        for col in columns.iter().filter(|c| c.applicable && c.weight > 0.0) {
            if let Some(s) = col.cells[index].0 {
                known_weight += col.weight;
                weighted += col.weight * s;
                if !col.def.is_cost() {
                    q_known += col.weight;
                    q_weighted += col.weight * s;
                }
            }
        }
        let score = if known_weight > 0.0 {
            weighted / known_weight
        } else {
            0.0
        };
        let quality = (q_known > 0.0).then(|| q_weighted / q_known * 100.0);
        let breakdown: Vec<CriterionScore> = columns
            .iter()
            .filter(|c| c.applicable)
            .map(|c| {
                let (s, text) = &c.cells[index];
                CriterionScore {
                    key: c.def.key.clone(),
                    label: c.def.label.clone(),
                    group: c.def.group.clone(),
                    weight: c.weight,
                    value: text.clone(),
                    score: *s,
                    points: match (s, known_weight > 0.0) {
                        (Some(s), true) if c.weight > 0.0 => c.weight * s / known_weight * 100.0,
                        _ => 0.0,
                    },
                }
            })
            .collect();
        let mut by_strength: Vec<&CriterionScore> = breakdown
            .iter()
            .filter(|b| b.weight > 0.0 && b.score.is_some())
            .collect();
        by_strength.sort_by(|a, b| {
            (b.weight * b.score.unwrap_or(0.0)).total_cmp(&(a.weight * a.score.unwrap_or(0.0)))
        });
        let strengths = by_strength
            .iter()
            .filter(|b| b.score.unwrap_or(0.0) >= 0.75)
            .take(3)
            .map(|b| b.label.clone())
            .collect();
        by_strength.sort_by(|a, b| {
            (b.weight * (1.0 - b.score.unwrap_or(1.0)))
                .total_cmp(&(a.weight * (1.0 - a.score.unwrap_or(1.0))))
        });
        let weaknesses = by_strength
            .iter()
            .filter(|b| b.score.unwrap_or(1.0) <= 0.3)
            .take(3)
            .map(|b| b.label.clone())
            .collect();
        let price = best.map(|b| b.comparable_cents);
        let value_index = match (quality, price, median_price) {
            (Some(q), Some(p), Some(m)) if p > 0 && m > 0.0 => Some(q / (p as f64 / m).sqrt()),
            _ => None,
        };
        Ranked {
            product_id: product.id.clone(),
            score: score * 100.0,
            confidence: if total_weight > 0.0 {
                known_weight / total_weight
            } else {
                0.0
            },
            quality,
            value_index,
            price_cents: price,
            shop: best.map(|b| b.shop.clone()),
            url: best.map(|b| b.url.clone()),
            tier: price.and_then(|p| tiers.tier_of(p)),
            on_frontier: false,
            breakdown,
            strengths,
            weaknesses,
        }
    }

    fn exclusions(product: &Product, best: Option<&BestOffer>, profile: &Profile) -> Vec<String> {
        let mut why = Vec::new();
        if let Some(brand) = &product.brand {
            if profile
                .exclude_brands
                .iter()
                .any(|b| b.eq_ignore_ascii_case(brand))
            {
                why.push(format!("brand {brand} excluded"));
            }
        }
        match best {
            None => why.push("no offer that fits (stock or condition)".into()),
            Some(b) => {
                if let Some(max) = profile.max_price_cents {
                    if b.comparable_cents > max {
                        why.push(format!(
                            "over the price limit by {} cents",
                            b.comparable_cents - max
                        ));
                    }
                }
            }
        }
        for c in &profile.constraints {
            if let Err(reason) = Self::check(product, best, c) {
                why.push(reason);
            }
        }
        why
    }

    fn check(product: &Product, best: Option<&BestOffer>, c: &Constraint) -> Result<(), String> {
        let unknown = || format!("{} unknown", c.attribute);
        let value: AttrValue = match c.attribute.as_str() {
            "price" => AttrValue::Num(best.ok_or_else(unknown)?.comparable_cents as f64 / 100.0),
            "brand" => AttrValue::Text(product.brand.clone().ok_or_else(unknown)?),
            "title" => AttrValue::Text(product.title.clone()),
            key => product.attributes.get(key).cloned().ok_or_else(unknown)?,
        };
        let ok = match c.op {
            Op::Gte => matches!((value.as_f64(), c.value.as_f64()), (Some(a), Some(b)) if a >= b),
            Op::Lte => matches!((value.as_f64(), c.value.as_f64()), (Some(a), Some(b)) if a <= b),
            Op::Eq => match (value.as_f64(), c.value.as_f64()) {
                (Some(a), Some(b)) if matches!(value, AttrValue::Num(_) | AttrValue::Bool(_)) => {
                    a == b
                }
                _ => value.tokens() == c.value.tokens(),
            },
            Op::Ne => value.tokens() != c.value.tokens(),
            Op::Contains => {
                let hay = value.tokens();
                c.value
                    .tokens()
                    .iter()
                    .all(|w| hay.iter().any(|t| t.contains(w.as_str())))
            }
            Op::AnyOf => {
                let hay = value.tokens();
                c.value.tokens().iter().any(|w| hay.contains(w))
            }
        };
        if ok {
            Ok(())
        } else {
            Err(format!(
                "{} {} does not meet {:?} {}",
                c.attribute, value, c.op, c.value
            ))
        }
    }

    fn median_price(offers: &[Option<BestOffer>]) -> Option<f64> {
        let mut p: Vec<i64> = offers
            .iter()
            .flatten()
            .map(|o| o.comparable_cents)
            .collect();
        if p.is_empty() {
            return None;
        }
        p.sort_unstable();
        let n = p.len();
        Some(if n % 2 == 1 {
            p[n / 2] as f64
        } else {
            (p[n / 2 - 1] + p[n / 2]) as f64 / 2.0
        })
    }

    /// Price bands by quartile of *all* products given, so a filter does not move the bands.
    fn tiers(schema: &CategorySchema, products: &[Product], offers: &[Option<BestOffer>]) -> Tiers {
        let mut prices: Vec<i64> = offers
            .iter()
            .flatten()
            .map(|o| o.comparable_cents)
            .collect();
        prices.sort_unstable();
        let _ = products;
        Tiers {
            prices,
            names: schema.tier_names(),
        }
    }

    fn bands(schema: &CategorySchema, tiers: &Tiers) -> Vec<TierBand> {
        let names = schema.tier_names();
        names
            .iter()
            .enumerate()
            .filter_map(|(i, label)| {
                let members: Vec<i64> = tiers
                    .prices
                    .iter()
                    .copied()
                    .filter(|p| tiers.index_of(*p) == Some(i))
                    .collect();
                Some(TierBand {
                    label: label.clone(),
                    from_cents: *members.first()?,
                    to_cents: *members.last()?,
                    count: members.len(),
                })
            })
            .collect()
    }

    fn mark_frontier(items: &mut [Ranked]) {
        let pts: Vec<Option<(i64, f64)>> =
            items.iter().map(|i| i.price_cents.zip(i.quality)).collect();
        for (i, item) in items.iter_mut().enumerate() {
            item.on_frontier = match pts[i] {
                None => false,
                Some((p, q)) => !pts.iter().enumerate().any(|(j, other)| {
                    j != i && other.is_some_and(|(op, oq)| op <= p && oq >= q && (op < p || oq > q))
                }),
            };
        }
    }

    fn picks(items: &[Ranked]) -> Picks {
        if items.is_empty() {
            return Picks::default();
        }
        let best_overall = Some(items[0].product_id.clone());
        let with_quality: Vec<&Ranked> = items.iter().filter(|i| i.quality.is_some()).collect();
        let premium = with_quality
            .iter()
            .max_by(|a, b| {
                a.quality
                    .partial_cmp(&b.quality)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(b.price_cents.cmp(&a.price_cents))
            })
            .map(|i| i.product_id.clone());
        let best_value = items
            .iter()
            .filter(|i| i.value_index.is_some())
            .max_by(|a, b| {
                a.value_index
                    .partial_cmp(&b.value_index)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|i| i.product_id.clone());
        // cheapest among the products whose quality is in the better half
        let mut qs: Vec<f64> = with_quality.iter().filter_map(|i| i.quality).collect();
        qs.sort_by(f64::total_cmp);
        let cheapest_good = qs.get(qs.len() / 2).and_then(|median| {
            with_quality
                .iter()
                .filter(|i| i.quality.is_some_and(|q| q >= *median) && i.price_cents.is_some())
                .min_by_key(|i| i.price_cents)
                .map(|i| i.product_id.clone())
        });
        Picks {
            best_overall,
            best_value,
            cheapest_good,
            premium,
        }
    }
}

struct BestOffer {
    comparable_cents: i64,
    monthly_cents: Option<i64>,
    upfront_cents: i64,
    term_months: u32,
    discount_pct: Option<f64>,
    shop: String,
    url: String,
}

struct Tiers {
    prices: Vec<i64>,
    names: Vec<String>,
}

impl Tiers {
    fn index_of(&self, price: i64) -> Option<usize> {
        let n = self.prices.len();
        if n == 0 {
            return None;
        }
        let below = self.prices.iter().filter(|p| **p < price).count();
        let equal = self.prices.iter().filter(|p| **p == price).count();
        let mid_rank = (below as f64 + equal as f64 / 2.0) / n as f64;
        Some(((mid_rank * self.names.len() as f64) as usize).min(self.names.len() - 1))
    }

    fn tier_of(&self, price: i64) -> Option<String> {
        self.index_of(price).map(|i| self.names[i].clone())
    }
}

/// Months since year 0 of `2025-09-24`, `2025-09` or `2025` (a bare year counts as mid-year).
fn month_index(text: &str) -> Option<f64> {
    let mut parts = text.trim().split(['-', '/', '.']);
    let first: i32 = parts.next()?.trim().parse().ok()?;
    let second: Option<i32> = parts.next().and_then(|m| m.trim().parse().ok());
    // 24.09.2025 style
    let (year, month) = if first > 31 {
        (first, second.unwrap_or(7))
    } else {
        let third: i32 = parts.next()?.trim().parse().ok()?;
        (third, second.unwrap_or(1))
    };
    (1900..=2200)
        .contains(&year)
        .then(|| f64::from(year) * 12.0 + f64::from(month.clamp(1, 12) - 1))
}

fn now_month(now: i64) -> f64 {
    1970.0 * 12.0 + now as f64 / 2_629_746.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::product::{Offer, Recurring};
    use crate::schema::Registry;

    const NOW: i64 = 1_790_000_000; // autumn 2026

    fn phone(name: &str, price: i64, attrs: &[(&str, AttrValue)]) -> Product {
        let mut p =
            Product::new("smartphone", name).with_offer(Offer::one_time("shop", "u", price));
        for (k, v) in attrs {
            p.attributes.insert(k.to_string(), v.clone());
        }
        p
    }

    fn n(v: f64) -> AttrValue {
        AttrValue::Num(v)
    }

    fn catalog() -> Vec<Product> {
        vec![
            phone(
                "Budget One",
                19_900,
                &[
                    ("battery_mah", n(5000.0)),
                    ("geekbench_multi", n(2500.0)),
                    ("update_years", n(3.0)),
                    ("released", "2025-10".into()),
                ],
            ),
            phone(
                "Mid Two",
                44_900,
                &[
                    ("battery_mah", n(5000.0)),
                    ("geekbench_multi", n(4500.0)),
                    ("update_years", n(6.0)),
                    ("released", "2026-03".into()),
                ],
            ),
            phone(
                "Flagship Three",
                109_900,
                &[
                    ("battery_mah", n(5200.0)),
                    ("geekbench_multi", n(8500.0)),
                    ("update_years", n(7.0)),
                    ("released", "2026-09".into()),
                ],
            ),
            phone(
                "Flagship Four",
                119_900,
                &[
                    ("battery_mah", n(4400.0)),
                    ("geekbench_multi", n(8000.0)),
                    ("update_years", n(7.0)),
                    ("released", "2026-09".into()),
                ],
            ),
        ]
    }

    fn rank(profile: &Profile) -> Ranking {
        let schema = Registry::builtin().resolved("smartphone").unwrap();
        Ranker::rank(&schema, &catalog(), profile, &Context::at(NOW))
    }

    #[test]
    fn default_weights_prefer_a_balanced_phone_and_explain_why() {
        let r = rank(&Profile::default());
        assert_eq!(r.items.len(), 4);
        let top = &r.items[0];
        assert!(top.score > r.items[3].score);
        assert!(top.confidence > 0.5 && top.confidence <= 1.0);
        let points: f64 = top.breakdown.iter().map(|b| b.points).sum();
        assert!(
            (points - top.score).abs() < 1e-6,
            "points add up to the score"
        );
        assert!(top
            .breakdown
            .iter()
            .any(|b| b.key == "battery" && b.value.as_deref() == Some("5000 mAh")));
        assert!(
            !top.breakdown.iter().any(|b| b.key == "ecosystem"),
            "no preference, no ecosystem criterion"
        );
    }

    #[test]
    fn weights_change_the_winner() {
        // only price matters -> the cheapest wins; only performance -> a flagship wins
        let cheap = rank(&Profile {
            weights: [("price".to_string(), 10.0)]
                .into_iter()
                .chain(
                    [
                        "performance",
                        "camera",
                        "battery",
                        "charging",
                        "display",
                        "storage",
                        "ram",
                        "updates",
                        "recency",
                        "water",
                        "weight",
                        "five_g",
                        "deal",
                    ]
                    .map(|k| (k.to_string(), 0.0)),
                )
                .collect(),
            ..Profile::default()
        });
        assert_eq!(cheap.items[0].product_id, "smartphone:budget-one");
        let fast = rank(&Profile {
            weights: [("performance".to_string(), 20.0)].into_iter().collect(),
            ..Profile::default()
        });
        assert!(fast.items[0].product_id.contains("flagship"));
    }

    #[test]
    fn missing_data_lowers_confidence_but_does_not_zero_the_score() {
        let schema = Registry::builtin().resolved("smartphone").unwrap();
        let bare = phone("Bare", 30_000, &[]);
        let r = Ranker::rank(
            &schema,
            &[bare, catalog().remove(1)],
            &Profile::default(),
            &Context::at(NOW),
        );
        let bare_item = r
            .items
            .iter()
            .find(|i| i.product_id.ends_with("bare"))
            .unwrap();
        let full_item = r
            .items
            .iter()
            .find(|i| i.product_id.ends_with("mid-two"))
            .unwrap();
        assert!(bare_item.confidence < full_item.confidence);
        assert!(bare_item.score > 0.0);
    }

    #[test]
    fn constraints_and_price_limit_exclude_with_reasons() {
        let r = rank(&Profile {
            max_price_cents: Some(50_000),
            constraints: vec![Constraint {
                attribute: "update_years".into(),
                op: Op::Gte,
                value: n(5.0),
            }],
            ..Profile::default()
        });
        assert_eq!(r.items.len(), 1);
        assert_eq!(r.items[0].product_id, "smartphone:mid-two");
        assert_eq!(r.excluded.len(), 3);
        assert!(r
            .excluded
            .iter()
            .any(|e| e.reasons.iter().any(|x| x.contains("price limit"))));
        assert!(r
            .excluded
            .iter()
            .any(|e| e.reasons.iter().any(|x| x.contains("update_years"))));
    }

    #[test]
    fn unknown_attribute_fails_a_constraint() {
        let r = rank(&Profile {
            constraints: vec![Constraint {
                attribute: "ram_gb".into(),
                op: Op::Gte,
                value: n(8.0),
            }],
            ..Profile::default()
        });
        assert!(r.items.is_empty());
        assert!(r.excluded[0].reasons[0].contains("unknown"));
    }

    #[test]
    fn price_tiers_say_which_category_a_phone_falls_into() {
        let r = rank(&Profile::default());
        let tier = |id: &str| {
            r.items
                .iter()
                .find(|i| i.product_id.ends_with(id))
                .unwrap()
                .tier
                .clone()
                .unwrap()
        };
        assert_eq!(tier("budget-one"), "budget");
        assert_eq!(tier("flagship-four"), "flagship");
        assert_eq!(r.tiers.len(), 4);
        assert_eq!(r.tiers.iter().map(|t| t.count).sum::<usize>(), 4);
        // a filter does not move the bands
        let filtered = rank(&Profile {
            max_price_cents: Some(50_000),
            ..Profile::default()
        });
        assert_eq!(filtered.tiers, r.tiers);
    }

    #[test]
    fn picks_separate_best_value_from_premium() {
        let r = rank(&Profile::default());
        let picks = &r.picks;
        assert_eq!(picks.premium.as_deref(), Some("smartphone:flagship-three"));
        assert!(picks.best_value.is_some());
        assert_ne!(picks.best_value, picks.premium);
        // the better half of four phones is the two flagships; the cheaper of them
        assert_eq!(
            picks.cheapest_good.as_deref(),
            Some("smartphone:flagship-three")
        );
        // Flagship Four is dearer and weaker than Flagship Three: not on the frontier
        let four = r
            .items
            .iter()
            .find(|i| i.product_id.ends_with("flagship-four"))
            .unwrap();
        assert!(!four.on_frontier);
        assert!(
            r.items
                .iter()
                .find(|i| i.product_id.ends_with("budget-one"))
                .unwrap()
                .on_frontier
        );
    }

    #[test]
    fn ecosystem_preference_switches_the_criterion_on() {
        let schema = Registry::builtin().resolved("smartphone").unwrap();
        let mut ios = Product::new("smartphone", "Apple iPhone X")
            .with_offer(Offer::one_time("s", "u", 60_000));
        ios.brand = Some("Apple".into());
        schema.derive_attributes(&ios.title, ios.brand.as_deref(), &mut ios.attributes);
        let mut droid =
            Product::new("smartphone", "Pixel Y").with_offer(Offer::one_time("s", "u", 60_000));
        schema.derive_attributes(&droid.title, None, &mut droid.attributes);
        let products = [ios, droid];
        let with_pref = Ranker::rank(
            &schema,
            &products,
            &Profile {
                preferences: [(
                    "ecosystem".to_string(),
                    Preference {
                        prefer: vec!["apple".into()],
                        avoid: vec![],
                    },
                )]
                .into_iter()
                .collect(),
                ..Profile::default()
            },
            &Context::at(NOW),
        );
        assert_eq!(with_pref.items[0].product_id, "smartphone:apple-iphone-x");
        assert!(with_pref.items[0]
            .breakdown
            .iter()
            .any(|b| b.key == "ecosystem" && b.score == Some(1.0)));
        let without = Ranker::rank(&schema, &products, &Profile::default(), &Context::at(NOW));
        assert!(!without.items[0]
            .breakdown
            .iter()
            .any(|b| b.key == "ecosystem"));
    }

    #[test]
    fn a_profile_can_add_its_own_criterion() {
        let extra: CriterionDef = serde_json::from_str(
            r#"{"key":"endurance","label":"Battery per gram","kind":"formula","expr":"battery_mah / weight_g","weight":50,"scale":{"type":"minmax"}}"#,
        ).unwrap();
        let mut a = phone(
            "Heavy",
            30_000,
            &[("battery_mah", n(5000.0)), ("weight_g", n(250.0))],
        );
        let mut b = phone(
            "Light",
            30_000,
            &[("battery_mah", n(5000.0)), ("weight_g", n(160.0))],
        );
        a.brand = None;
        b.brand = None;
        let schema = Registry::builtin().resolved("smartphone").unwrap();
        let r = Ranker::rank(
            &schema,
            &[a, b],
            &Profile {
                extra_criteria: vec![extra],
                ..Profile::default()
            },
            &Context::at(NOW),
        );
        assert_eq!(r.items[0].product_id, "smartphone:light");
        let cell = r.items[0]
            .breakdown
            .iter()
            .find(|b| b.key == "endurance")
            .unwrap();
        assert_eq!(cell.score, Some(1.0));
        assert_eq!(cell.value.as_deref(), Some("31.25"));
    }

    #[test]
    fn plans_are_compared_by_total_cost_over_the_term() {
        let schema = Registry::builtin().resolved("mobile_plan").unwrap();
        let plan = |name: &str, r: Recurring, attrs: &[(&str, AttrValue)]| {
            let mut p = Product::new("mobile_plan", name).with_offer(Offer::plan("telco", "u", r));
            for (k, v) in attrs {
                p.attributes.insert(k.to_string(), v.clone());
            }
            p
        };
        // looks cheap per month, but the fee and the short promo make it dearer over 24 months
        let teaser = plan(
            "Teaser",
            Recurring {
                monthly_cents: 2_500,
                promo_months: 3,
                promo_monthly_cents: Some(0),
                setup_cents: 4_000,
                min_term_months: 24,
                ..Default::default()
            },
            &[("data_gb", n(20.0))],
        );
        let steady = plan(
            "Steady",
            Recurring {
                monthly_cents: 1_800,
                ..Default::default()
            },
            &[("data_gb", n(20.0))],
        );
        let r = Ranker::rank(
            &schema,
            &[teaser, steady],
            &Profile::default(),
            &Context::at(NOW),
        );
        assert_eq!(r.items[0].product_id, "mobile_plan:steady");
        assert_eq!(r.items[0].price_cents, Some(1_800));
        let teaser_monthly = r.items[1].price_cents.unwrap();
        assert_eq!(teaser_monthly, (4_000 + 21 * 2_500 + 12) / 24);
        assert!(r.items[0]
            .breakdown
            .iter()
            .any(|b| b.key == "flexibility" && b.score == Some(1.0)));
        assert!(
            r.items[1]
                .breakdown
                .iter()
                .any(|b| b.key == "price"
                    && b.value.as_deref().is_some_and(|v| v.ends_with("/month")))
        );
    }

    #[test]
    fn deals_use_the_price_history_when_given() {
        let schema = Registry::builtin().resolved("smartphone").unwrap();
        let products = catalog();
        let mut deals = BTreeMap::new();
        deals.insert(
            products[1].id.clone(),
            crate::deals::DealInfo {
                discount_pct: 30.0,
                ..crate::deals::DealInfo::none(44_900)
            },
        );
        let r = Ranker::rank(
            &schema,
            &products,
            &Profile::default(),
            &Context {
                now: NOW,
                deals: &deals,
            },
        );
        let mid = r
            .items
            .iter()
            .find(|i| i.product_id.ends_with("mid-two"))
            .unwrap();
        let deal = mid.breakdown.iter().find(|b| b.key == "deal").unwrap();
        assert_eq!(deal.score, Some(0.75));
        assert_eq!(deal.value.as_deref(), Some("30 % below usual"));
    }

    #[test]
    fn newer_phones_score_higher_on_newness() {
        let r = rank(&Profile::default());
        let rec = |id: &str| {
            r.items
                .iter()
                .find(|i| i.product_id.ends_with(id))
                .unwrap()
                .breakdown
                .iter()
                .find(|b| b.key == "recency")
                .unwrap()
                .score
                .unwrap()
        };
        assert!(rec("flagship-three") > rec("mid-two"));
        assert!(rec("mid-two") > rec("budget-one"));
    }

    #[test]
    fn empty_input_is_an_empty_ranking() {
        let schema = Registry::builtin().resolved("smartphone").unwrap();
        let r = Ranker::rank(&schema, &[], &Profile::default(), &Context::at(NOW));
        assert!(r.items.is_empty() && r.picks == Picks::default() && r.tiers.is_empty());
    }

    #[test]
    fn dates_in_several_notations_parse() {
        assert_eq!(month_index("2025-09-24"), Some(2025.0 * 12.0 + 8.0));
        assert_eq!(month_index("2025-09"), Some(2025.0 * 12.0 + 8.0));
        assert_eq!(month_index("24.09.2025"), Some(2025.0 * 12.0 + 8.0));
        assert_eq!(month_index("2025"), Some(2025.0 * 12.0 + 6.0));
        assert_eq!(month_index("soon"), None);
    }
}
