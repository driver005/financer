//! The shopping assistant's domain, free of I/O: products and offers, extensible category
//! schemas with criteria, ranking with explanations, deal detection, subscription costs and a
//! search index. Everything that fetches pages or stores data lives in other crates.

pub mod deals;
pub mod formula;
pub mod product;
pub mod rank;
pub mod schema;
pub mod search;
pub mod text;
pub mod value;

pub use deals::{
    assess, worth_repeating, DealEvent, DealInfo, EventKind, PricePoint, Verdict, Watch,
};
pub use formula::{Formula, FormulaError};
pub use product::{Condition, Offer, Product, Recurring, DEFAULT_HORIZON_MONTHS};
pub use rank::{
    Constraint, Context, CriterionScore, Excluded, Op, Picks, Preference, Profile, Ranked, Ranker,
    Ranking, TierBand,
};
pub use schema::{
    AttrKind, AttributeDef, CategoryKind, CategorySchema, CriterionDef, CriterionKind, DeriveRule,
    Missing, Registry, Scale, SchemaError,
};
pub use search::{Hit, Index, ParsedQuery};
pub use value::{AttrValue, Attributes};
