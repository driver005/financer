//! Automatic receipt sources: provenance columns on `receipts`, a place for each source's
//! cursor and (encrypted) secret, and a record of which mails and files were already seen.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum Receipts {
    Table,
    Source,
    Retailer,
    TotalCents,
    ReceiptTime,
    TransactionId,
    CreatedAt,
}

#[derive(DeriveIden)]
enum ReceiptSourceState {
    Table,
    Source,
    State,
    Secret,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum ReceiptSeen {
    Table,
    Id,
    Source,
    ItemKey,
    Outcome,
    SeenAt,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite adds one column per ALTER statement.
        let columns = [
            ColumnDef::new(Receipts::Source)
                .string()
                .not_null()
                .default("manual")
                .to_owned(),
            ColumnDef::new(Receipts::Retailer).string().null().to_owned(),
            ColumnDef::new(Receipts::TotalCents)
                .big_integer()
                .null()
                .to_owned(),
            ColumnDef::new(Receipts::ReceiptTime)
                .string()
                .null()
                .to_owned(),
            ColumnDef::new(Receipts::TransactionId)
                .big_integer()
                .null()
                .to_owned(),
            ColumnDef::new(Receipts::CreatedAt)
                .big_integer()
                .not_null()
                .default(0)
                .to_owned(),
        ];
        for mut column in columns {
            manager
                .alter_table(
                    Table::alter()
                        .table(Receipts::Table)
                        .add_column(&mut column)
                        .to_owned(),
                )
                .await?;
        }

        manager
            .create_table(
                Table::create()
                    .table(ReceiptSourceState::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ReceiptSourceState::Source)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ReceiptSourceState::State).text().not_null())
                    .col(ColumnDef::new(ReceiptSourceState::Secret).text().null())
                    .col(
                        ColumnDef::new(ReceiptSourceState::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(ReceiptSeen::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ReceiptSeen::Id)
                            .big_integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ReceiptSeen::Source).string().not_null())
                    .col(ColumnDef::new(ReceiptSeen::ItemKey).string().not_null())
                    .col(ColumnDef::new(ReceiptSeen::Outcome).string().not_null())
                    .col(
                        ColumnDef::new(ReceiptSeen::SeenAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_receipt_seen_source_key")
                    .table(ReceiptSeen::Table)
                    .col(ReceiptSeen::Source)
                    .col(ReceiptSeen::ItemKey)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ReceiptSeen::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(ReceiptSourceState::Table).to_owned())
            .await
    }
}
