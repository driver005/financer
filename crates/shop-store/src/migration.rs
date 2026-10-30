//! The shopping app's own migrations, tracked in their own table so they never collide with the
//! finance app's when both live in one database.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
struct CreateShopTables;

#[derive(DeriveIden)]
enum Products {
    #[sea_orm(iden = "shop_products")]
    Table,
    Id,
    Category,
    Title,
    Gtin,
    Data,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Offers {
    #[sea_orm(iden = "shop_offers")]
    Table,
    Id,
    ProductId,
    Shop,
    Url,
    Condition,
    ComparableCents,
    SeenAt,
    Data,
}

#[derive(DeriveIden)]
enum PricePoints {
    #[sea_orm(iden = "shop_price_points")]
    Table,
    Id,
    ProductId,
    At,
    Cents,
}

#[derive(DeriveIden)]
enum Schemas {
    #[sea_orm(iden = "shop_schemas")]
    Table,
    Id,
    Data,
}

#[derive(DeriveIden)]
enum Profiles {
    #[sea_orm(iden = "shop_profiles")]
    Table,
    Name,
    Data,
}

#[derive(DeriveIden)]
enum Watches {
    #[sea_orm(iden = "shop_watches")]
    Table,
    Id,
    Data,
    Enabled,
}

#[derive(DeriveIden)]
enum Events {
    #[sea_orm(iden = "shop_events")]
    Table,
    Id,
    Key,
    WatchId,
    ProductId,
    PriceCents,
    Data,
    CreatedAt,
    DeliveredAt,
    ReadAt,
}

#[derive(DeriveIden)]
enum Frontier {
    #[sea_orm(iden = "shop_frontier")]
    Table,
    Url,
    Source,
    Kind,
    Category,
    Depth,
    IntervalSecs,
    NextAt,
    Fails,
}

#[derive(DeriveIden)]
enum PushTokens {
    #[sea_orm(iden = "shop_push_tokens")]
    Table,
    Token,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Kv {
    #[sea_orm(iden = "shop_kv")]
    Table,
    Key,
    Value,
}

fn big(c: impl IntoIden) -> ColumnDef {
    let mut d = ColumnDef::new(c);
    d.big_integer().not_null();
    d
}
fn text(c: impl IntoIden) -> ColumnDef {
    let mut d = ColumnDef::new(c);
    d.text().not_null();
    d
}
fn string(c: impl IntoIden) -> ColumnDef {
    let mut d = ColumnDef::new(c);
    d.string().not_null();
    d
}

#[async_trait::async_trait]
impl MigrationTrait for CreateShopTables {
    async fn up(&self, m: &SchemaManager) -> Result<(), DbErr> {
        m.create_table(
            Table::create()
                .table(Products::Table)
                .if_not_exists()
                .col(string(Products::Id).primary_key())
                .col(string(Products::Category))
                .col(string(Products::Title))
                .col(ColumnDef::new(Products::Gtin).string().null())
                .col(text(Products::Data))
                .col(big(Products::CreatedAt))
                .col(big(Products::UpdatedAt))
                .to_owned(),
        )
        .await?;
        m.create_index(
            Index::create()
                .name("idx_shop_products_category")
                .table(Products::Table)
                .col(Products::Category)
                .if_not_exists()
                .to_owned(),
        )
        .await?;
        m.create_index(
            Index::create()
                .name("idx_shop_products_gtin")
                .table(Products::Table)
                .col(Products::Gtin)
                .if_not_exists()
                .to_owned(),
        )
        .await?;

        m.create_table(
            Table::create()
                .table(Offers::Table)
                .if_not_exists()
                .col(big(Offers::Id).auto_increment().primary_key())
                .col(string(Offers::ProductId))
                .col(string(Offers::Shop))
                .col(string(Offers::Url))
                .col(string(Offers::Condition))
                .col(big(Offers::ComparableCents))
                .col(big(Offers::SeenAt))
                .col(text(Offers::Data))
                .to_owned(),
        )
        .await?;
        m.create_index(
            Index::create()
                .name("idx_shop_offers_identity")
                .table(Offers::Table)
                .col(Offers::ProductId)
                .col(Offers::Shop)
                .col(Offers::Url)
                .col(Offers::Condition)
                .unique()
                .if_not_exists()
                .to_owned(),
        )
        .await?;

        m.create_table(
            Table::create()
                .table(PricePoints::Table)
                .if_not_exists()
                .col(big(PricePoints::Id).auto_increment().primary_key())
                .col(string(PricePoints::ProductId))
                .col(big(PricePoints::At))
                .col(big(PricePoints::Cents))
                .to_owned(),
        )
        .await?;
        m.create_index(
            Index::create()
                .name("idx_shop_price_points_product")
                .table(PricePoints::Table)
                .col(PricePoints::ProductId)
                .col(PricePoints::At)
                .if_not_exists()
                .to_owned(),
        )
        .await?;

        m.create_table(
            Table::create()
                .table(Schemas::Table)
                .if_not_exists()
                .col(string(Schemas::Id).primary_key())
                .col(text(Schemas::Data))
                .to_owned(),
        )
        .await?;
        m.create_table(
            Table::create()
                .table(Profiles::Table)
                .if_not_exists()
                .col(string(Profiles::Name).primary_key())
                .col(text(Profiles::Data))
                .to_owned(),
        )
        .await?;
        m.create_table(
            Table::create()
                .table(Watches::Table)
                .if_not_exists()
                .col(big(Watches::Id).auto_increment().primary_key())
                .col(text(Watches::Data))
                .col(ColumnDef::new(Watches::Enabled).boolean().not_null())
                .to_owned(),
        )
        .await?;

        m.create_table(
            Table::create()
                .table(Events::Table)
                .if_not_exists()
                .col(big(Events::Id).auto_increment().primary_key())
                .col(string(Events::Key).unique_key())
                .col(big(Events::WatchId))
                .col(string(Events::ProductId))
                .col(big(Events::PriceCents))
                .col(text(Events::Data))
                .col(big(Events::CreatedAt))
                .col(ColumnDef::new(Events::DeliveredAt).big_integer().null())
                .col(ColumnDef::new(Events::ReadAt).big_integer().null())
                .to_owned(),
        )
        .await?;

        m.create_table(
            Table::create()
                .table(Frontier::Table)
                .if_not_exists()
                .col(string(Frontier::Url).primary_key())
                .col(string(Frontier::Source))
                .col(string(Frontier::Kind))
                .col(ColumnDef::new(Frontier::Category).string().null())
                .col(ColumnDef::new(Frontier::Depth).integer().not_null())
                .col(big(Frontier::IntervalSecs))
                .col(big(Frontier::NextAt))
                .col(ColumnDef::new(Frontier::Fails).integer().not_null())
                .to_owned(),
        )
        .await?;
        m.create_index(
            Index::create()
                .name("idx_shop_frontier_next")
                .table(Frontier::Table)
                .col(Frontier::NextAt)
                .if_not_exists()
                .to_owned(),
        )
        .await?;

        m.create_table(
            Table::create()
                .table(PushTokens::Table)
                .if_not_exists()
                .col(string(PushTokens::Token).primary_key())
                .col(big(PushTokens::CreatedAt))
                .to_owned(),
        )
        .await?;
        m.create_table(
            Table::create()
                .table(Kv::Table)
                .if_not_exists()
                .col(string(Kv::Key).primary_key())
                .col(text(Kv::Value))
                .to_owned(),
        )
        .await?;
        Ok(())
    }
}

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(CreateShopTables)]
    }

    fn migration_table_name() -> DynIden {
        Alias::new("seaql_migrations_shop").into_iden()
    }
}
