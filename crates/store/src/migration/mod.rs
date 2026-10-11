//! Dialect-neutral migrations: only portable column types, no raw SQL.

use sea_orm_migration::prelude::*;

mod m20261011_000001_create_transactions;
mod m20261011_000002_create_budget_envelopes;
mod m20261011_000003_create_price_quotes;
mod m20261011_000004_create_usual_items;
mod m20261011_000005_create_receipts;
mod m20261011_000006_create_settings;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20261011_000001_create_transactions::Migration),
            Box::new(m20261011_000002_create_budget_envelopes::Migration),
            Box::new(m20261011_000003_create_price_quotes::Migration),
            Box::new(m20261011_000004_create_usual_items::Migration),
            Box::new(m20261011_000005_create_receipts::Migration),
            Box::new(m20261011_000006_create_settings::Migration),
        ]
    }
}
