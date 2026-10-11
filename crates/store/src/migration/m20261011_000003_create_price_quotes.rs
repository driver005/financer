use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum PriceQuotes {
    Table,
    Id,
    Item,
    Chain,
    PriceCents,
    ShelfPriceCents,
    ProductName,
    ValidUntil,
    IsOffer,
    Source,
    FetchedAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(PriceQuotes::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(PriceQuotes::Id)
                            .big_integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(PriceQuotes::Item).string().not_null())
                    .col(ColumnDef::new(PriceQuotes::Chain).string().not_null())
                    .col(
                        ColumnDef::new(PriceQuotes::PriceCents)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PriceQuotes::ShelfPriceCents)
                            .big_integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(PriceQuotes::ProductName).string().not_null())
                    .col(ColumnDef::new(PriceQuotes::ValidUntil).date().null())
                    .col(ColumnDef::new(PriceQuotes::IsOffer).boolean().not_null())
                    .col(ColumnDef::new(PriceQuotes::Source).string().not_null())
                    .col(
                        ColumnDef::new(PriceQuotes::FetchedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(PriceQuotes::Table).to_owned())
            .await
    }
}
