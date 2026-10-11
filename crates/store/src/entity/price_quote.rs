use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "price_quotes")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub item: String,
    pub chain: String,
    /// Price of the item's reference pack (see `financer_core::reference_milli`).
    pub price_cents: i64,
    pub shelf_price_cents: i64,
    pub product_name: String,
    pub valid_until: Option<TimeDate>,
    pub is_offer: bool,
    pub source: String,
    /// Unix seconds.
    pub fetched_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
