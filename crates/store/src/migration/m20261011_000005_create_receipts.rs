use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum Receipts {
    Table,
    Id,
    Fingerprint,
    ReceiptDate,
    Merchant,
    Json,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Receipts::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Receipts::Id)
                            .big_integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Receipts::Fingerprint)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(Receipts::ReceiptDate).date().null())
                    .col(ColumnDef::new(Receipts::Merchant).string().null())
                    .col(ColumnDef::new(Receipts::Json).text().not_null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Receipts::Table).to_owned())
            .await
    }
}
