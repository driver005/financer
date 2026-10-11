use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum BudgetEnvelopes {
    Table,
    Category,
    LimitCents,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(BudgetEnvelopes::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(BudgetEnvelopes::Category)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(BudgetEnvelopes::LimitCents)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(BudgetEnvelopes::Table).to_owned())
            .await
    }
}
