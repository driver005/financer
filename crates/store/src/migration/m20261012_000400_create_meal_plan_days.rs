use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum MealPlanDays {
    Table,
    PlanDate,
    RecipeId,
    Title,
    Servings,
    BaseServings,
    IngredientsJson,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(MealPlanDays::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(MealPlanDays::PlanDate)
                            .date()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(MealPlanDays::RecipeId).string().null())
                    .col(ColumnDef::new(MealPlanDays::Title).string().not_null())
                    .col(ColumnDef::new(MealPlanDays::Servings).integer().not_null())
                    .col(
                        ColumnDef::new(MealPlanDays::BaseServings)
                            .integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(MealPlanDays::IngredientsJson).text().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(MealPlanDays::Table).to_owned())
            .await
    }
}
