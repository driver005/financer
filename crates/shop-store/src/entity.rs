//! Table definitions. Rich values (a product's attributes, an offer, a schema) are stored as
//! JSON text so that new attributes and criteria never need a migration.

macro_rules! entity {
    ($m:ident, $table:literal, { $($body:tt)* }) => {
        pub mod $m {
            use sea_orm::entity::prelude::*;

            #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
            #[sea_orm(table_name = $table)]
            pub struct Model { $($body)* }

            #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
            pub enum Relation {}

            impl ActiveModelBehavior for ActiveModel {}
        }
    };
}

entity!(product, "shop_products", {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub category: String,
    pub title: String,
    pub gtin: Option<String>,
    /// The product without its offers, as JSON.
    pub data: String,
    pub created_at: i64,
    pub updated_at: i64,
});

entity!(offer, "shop_offers", {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub product_id: String,
    pub shop: String,
    pub url: String,
    pub condition: String,
    pub comparable_cents: i64,
    pub seen_at: i64,
    pub data: String,
});

entity!(price_point, "shop_price_points", {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub product_id: String,
    pub at: i64,
    pub cents: i64,
});

entity!(schema, "shop_schemas", {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub data: String,
});

entity!(profile, "shop_profiles", {
    #[sea_orm(primary_key, auto_increment = false)]
    pub name: String,
    pub data: String,
});

entity!(watch, "shop_watches", {
    #[sea_orm(primary_key)]
    pub id: i64,
    pub data: String,
    pub enabled: bool,
});

entity!(event, "shop_events", {
    #[sea_orm(primary_key)]
    pub id: i64,
    #[sea_orm(unique)]
    pub key: String,
    pub watch_id: i64,
    pub product_id: String,
    pub price_cents: i64,
    pub data: String,
    pub created_at: i64,
    pub delivered_at: Option<i64>,
    pub read_at: Option<i64>,
});

entity!(frontier, "shop_frontier", {
    #[sea_orm(primary_key, auto_increment = false)]
    pub url: String,
    pub source: String,
    pub kind: String,
    pub category: Option<String>,
    pub depth: i32,
    pub interval_secs: i64,
    pub next_at: i64,
    pub fails: i32,
});

entity!(push_token, "shop_push_tokens", {
    #[sea_orm(primary_key, auto_increment = false)]
    pub token: String,
    pub created_at: i64,
});

entity!(kv, "shop_kv", {
    #[sea_orm(primary_key, auto_increment = false)]
    pub key: String,
    pub value: String,
});
