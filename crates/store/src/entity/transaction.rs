use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "transactions")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    /// `Transaction::fingerprint`, unique so re-importing a period never duplicates rows.
    #[sea_orm(unique)]
    pub fingerprint: String,
    pub booking_date: TimeDate,
    pub amount_cents: i64,
    pub counterparty: String,
    pub purpose: String,
    pub counterparty_iban: Option<String>,
    /// Snake-case `Category` name, e.g. `groceries`.
    pub category: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
