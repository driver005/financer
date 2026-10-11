use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(DeriveIden)]
enum Transactions {
    Table,
    Id,
    Fingerprint,
    BookingDate,
    AmountCents,
    Counterparty,
    Purpose,
    CounterpartyIban,
    Category,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Transactions::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Transactions::Id)
                            .big_integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Transactions::Fingerprint)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(Transactions::BookingDate).date().not_null())
                    .col(
                        ColumnDef::new(Transactions::AmountCents)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Transactions::Counterparty)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Transactions::Purpose).text().not_null())
                    .col(
                        ColumnDef::new(Transactions::CounterpartyIban)
                            .string()
                            .null(),
                    )
                    .col(ColumnDef::new(Transactions::Category).string().null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_transactions_booking_date")
                    .table(Transactions::Table)
                    .col(Transactions::BookingDate)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Transactions::Table).to_owned())
            .await
    }
}
