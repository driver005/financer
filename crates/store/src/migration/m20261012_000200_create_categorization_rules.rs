use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum CategorizationRules {
    Table,
    Id,
    Priority,
    Pattern,
    MatchKind,
    Sign,
    MinCents,
    MaxCents,
    Category,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(CategorizationRules::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(CategorizationRules::Id)
                            .big_integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(CategorizationRules::Priority)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CategorizationRules::Pattern)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CategorizationRules::MatchKind)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(CategorizationRules::Sign).string().null())
                    .col(
                        ColumnDef::new(CategorizationRules::MinCents)
                            .big_integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(CategorizationRules::MaxCents)
                            .big_integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(CategorizationRules::Category)
                            .string()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(CategorizationRules::Table).to_owned())
            .await
    }
}
