use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

/// Categories the user chose by hand for one transaction. Re-applying the rules skips these, so
/// a correction is never undone by a later rule run. Keyed by transaction fingerprint.
#[derive(DeriveIden)]
enum TransactionCategoryOverrides {
    Table,
    TransactionFingerprint,
    Category,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(TransactionCategoryOverrides::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TransactionCategoryOverrides::TransactionFingerprint)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(TransactionCategoryOverrides::Category)
                            .string()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(TransactionCategoryOverrides::Table)
                    .to_owned(),
            )
            .await
    }
}
