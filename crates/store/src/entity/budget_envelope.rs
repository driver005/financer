use sea_orm::entity::prelude::*;

/// Monthly spending limit for one category (`category` is the snake-case `Category` name).
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "budget_envelopes")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub category: String,
    pub limit_cents: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
