use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// Parts of a split transaction. They are keyed by the transaction's fingerprint (its stable
/// identity, see `Transaction::fingerprint`) rather than its database id, so they survive a
/// backup restore, which assigns new ids.
#[derive(DeriveIden)]
enum TransactionSplits {
    Table,
    Id,
    TransactionFingerprint,
    Position,
    AmountCents,
    Category,
    Note,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(TransactionSplits::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TransactionSplits::Id)
                            .big_integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(TransactionSplits::TransactionFingerprint)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TransactionSplits::Position)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TransactionSplits::AmountCents)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TransactionSplits::Category)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(TransactionSplits::Note).text().null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_transaction_splits_fingerprint")
                    .table(TransactionSplits::Table)
                    .col(TransactionSplits::TransactionFingerprint)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(TransactionSplits::Table).to_owned())
            .await
    }
}
