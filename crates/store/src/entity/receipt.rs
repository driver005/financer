use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "receipts")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique)]
    pub fingerprint: String,
    pub receipt_date: Option<TimeDate>,
    pub merchant: Option<String>,
    /// The parsed receipt as JSON.
    pub json: String,
    /// Where it came from: `manual`, `email`, `lidl_plus` or `folder`.
    pub source: String,
    /// Chain or brand the receipt is from (`rewe`, `lidl`, `edeka`, ...), when recognised.
    pub retailer: Option<String>,
    /// Printed total in cents, when there was one.
    pub total_cents: Option<i64>,
    /// Time of day on the receipt, `HH:MM`, when printed.
    pub receipt_time: Option<String>,
    /// The bank transaction this receipt was matched to, when it could be matched unambiguously.
    pub transaction_id: Option<i64>,
    /// Unix seconds the receipt was stored.
    pub created_at: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
