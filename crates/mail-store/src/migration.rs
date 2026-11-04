//! The mail client's own migrations, tracked in their own table so they never collide with the
//! finance or shopping migrations when they share one database.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
struct CreateMailTables;

#[derive(DeriveIden)]
enum Messages {
    #[sea_orm(iden = "mail_messages")]
    Table,
    Id,
    MessageId,
    Folder,
    Uid,
    InReplyTo,
    Refs,
    Subject,
    FromName,
    FromEmail,
    ToJson,
    CcJson,
    SentAt,
    Body,
    Snippet,
    Outgoing,
    Seen,
    Automated,
    CreatedAt,
}

#[derive(DeriveIden)]
enum Events {
    #[sea_orm(iden = "mail_events")]
    Table,
    Id,
    Uid,
    MessageRow,
    Title,
    Starts,
    Ends,
    AllDay,
    Location,
    Description,
    Organizer,
    Source,
    Sequence,
    Status,
    Recurrence,
    Note,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum Templates {
    #[sea_orm(iden = "mail_templates")]
    Table,
    Id,
    Kind,
    Name,
    Body,
    Fallback,
    Audience,
    IsDefault,
    Position,
}

#[derive(DeriveIden)]
enum Kv {
    #[sea_orm(iden = "mail_kv")]
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
fn flag(c: impl IntoIden) -> ColumnDef {
    let mut d = ColumnDef::new(c);
    d.boolean().not_null();
    d
}
fn opt_text(c: impl IntoIden) -> ColumnDef {
    let mut d = ColumnDef::new(c);
    d.text().null();
    d
}

#[async_trait::async_trait]
impl MigrationTrait for CreateMailTables {
    async fn up(&self, m: &SchemaManager) -> Result<(), DbErr> {
        m.create_table(
            Table::create()
                .table(Messages::Table)
                .if_not_exists()
                .col(big(Messages::Id).auto_increment().primary_key())
                .col(string(Messages::MessageId).unique_key())
                .col(string(Messages::Folder))
                .col(ColumnDef::new(Messages::Uid).big_integer().null())
                .col(ColumnDef::new(Messages::InReplyTo).string().null())
                .col(text(Messages::Refs))
                .col(text(Messages::Subject))
                .col(opt_text(Messages::FromName))
                .col(string(Messages::FromEmail))
                .col(text(Messages::ToJson))
                .col(text(Messages::CcJson))
                .col(big(Messages::SentAt))
                .col(text(Messages::Body))
                .col(text(Messages::Snippet))
                .col(flag(Messages::Outgoing))
                .col(flag(Messages::Seen))
                .col(flag(Messages::Automated))
                .col(big(Messages::CreatedAt))
                .to_owned(),
        )
        .await?;
        m.create_index(
            Index::create()
                .name("idx_mail_messages_sent_at")
                .table(Messages::Table)
                .col(Messages::SentAt)
                .if_not_exists()
                .to_owned(),
        )
        .await?;

        m.create_table(
            Table::create()
                .table(Events::Table)
                .if_not_exists()
                .col(big(Events::Id).auto_increment().primary_key())
                .col(string(Events::Uid).unique_key())
                .col(ColumnDef::new(Events::MessageRow).big_integer().null())
                .col(text(Events::Title))
                .col(string(Events::Starts))
                .col(ColumnDef::new(Events::Ends).string().null())
                .col(flag(Events::AllDay))
                .col(opt_text(Events::Location))
                .col(opt_text(Events::Description))
                .col(opt_text(Events::Organizer))
                .col(string(Events::Source))
                .col(big(Events::Sequence))
                .col(string(Events::Status))
                .col(opt_text(Events::Recurrence))
                .col(opt_text(Events::Note))
                .col(big(Events::CreatedAt))
                .col(big(Events::UpdatedAt))
                .to_owned(),
        )
        .await?;
        m.create_index(
            Index::create()
                .name("idx_mail_events_starts")
                .table(Events::Table)
                .col(Events::Starts)
                .if_not_exists()
                .to_owned(),
        )
        .await?;

        m.create_table(
            Table::create()
                .table(Templates::Table)
                .if_not_exists()
                .col(big(Templates::Id).auto_increment().primary_key())
                .col(string(Templates::Kind))
                .col(string(Templates::Name))
                .col(text(Templates::Body))
                .col(opt_text(Templates::Fallback))
                .col(text(Templates::Audience))
                .col(flag(Templates::IsDefault))
                .col(big(Templates::Position))
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
        vec![Box::new(CreateMailTables)]
    }

    fn migration_table_name() -> DynIden {
        Alias::new("seaql_migrations_mail").into_iden()
    }
}
