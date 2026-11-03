//! The SDK against the real shopping router (no network): every call, and how refusals come back.

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use axum::body::Body;
use axum::http::Request as HttpRequest;
use axum::Router;
use financer_prices::FakeHttp;
use financer_sdk::shop::*;
use financer_sdk::{Request, Response, SdkError, ShopSdk, Transport};
use financer_shop_api::{ShopApi, ShopConfig, ShopState};
use financer_shop_core::Registry;
use financer_shop_sources::{parse_sources, Crawler};
use financer_shop_store::ShopStore;
use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

const PHONES: &str = "\
name;price;link;brand;ean;uvp;Akkukapazität;Arbeitsspeicher;Speicher;Update-Garantie;Betriebssystem;Erscheinungsdatum;Geekbench
Budget Phone B1;199,00;https://feed.test/b1;Brandless;;249,00;5000 mAh;4 GB;64 GB;3;Android 14;2026-01;2500
Mid Phone M2;449,00;https://feed.test/m2;Midco;;;5000 mAh;8 GB;128 GB;6;Android 15;2026-05;4500
Flagship F3;1099,00;https://feed.test/f3;Topco;;;5200 mAh;12 GB;256 GB;7;Android 15;2026-09;8500
Apple iPhone Z;999,00;https://feed.test/ip;Apple;;;3900 mAh;8 GB;256 GB;7;iOS 19;2026-09;8000
";

const PLANS: &str = "\
name;price;link;monthly;term;promo_n;promo;setup;Datenvolumen;Netz;5G;EU-Roaming
Flex 10;0;https://tel.test/flex10;14,99;0;;;0;10 GB;o2;ja;ja
Teaser 30;0;https://tel.test/teaser30;24,99;24;6;0,00;39,99;30 GB;telekom;ja;ja
";

/// Calls the shop's router in the same process, mounted where the server mounts it.
struct InProcess(Router);

#[async_trait]
impl Transport for InProcess {
    async fn send(&self, r: Request) -> Result<Response, SdkError> {
        let mut req = HttpRequest::builder()
            .method(r.method.as_str())
            .uri(r.path.as_str());
        let body = match r.body {
            Some(b) => {
                req = req.header("content-type", "application/json");
                Body::from(b)
            }
            None => Body::empty(),
        };
        let res = self
            .0
            .clone()
            .oneshot(req.body(body).unwrap())
            .await
            .unwrap();
        let status = res.status().as_u16();
        let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
        Ok(Response { status, body })
    }
}

async fn sdk() -> Arc<ShopSdk> {
    let http = Arc::new(FakeHttp::with(vec![
        ("https://feed.test/phones.csv", 200, PHONES),
        ("https://tel.test/plans.csv", 200, PLANS),
    ]));
    let sources = parse_sources(
        r#"[
          {"name": "phones", "kind": "feed", "feed_url": "https://feed.test/phones.csv", "category": "smartphone", "shop": "PhoneShop",
           "mapping": {"title": "name", "price": "price", "url": "link", "brand": "brand", "list_price": "uvp"}},
          {"name": "plans", "kind": "feed", "feed_url": "https://tel.test/plans.csv", "category": "mobile_plan", "shop": "TelcoShop",
           "mapping": {"title": "name", "price": "price", "url": "link", "monthly": "monthly", "min_term_months": "term",
                       "promo_months": "promo_n", "promo_monthly": "promo", "setup": "setup"}}
        ]"#,
    )
    .unwrap();
    let store = ShopStore::connect("sqlite::memory:").await.unwrap();
    let registry = Arc::new(RwLock::new(Registry::builtin()));
    let now = Arc::new(AtomicI64::new(1_790_000_000));
    let c = now.clone();
    let crawler =
        Crawler::new(http, registry.clone(), sources).with_clock(move || c.load(Ordering::SeqCst));
    let state = ShopState::new(
        store,
        registry,
        crawler,
        ShopConfig {
            continuous: true,
            ..ShopConfig::default()
        },
    )
    .with_clock(move || now.load(Ordering::SeqCst));
    let app = Router::new().nest("/v1/shop", ShopApi::router(state));
    ShopSdk::with_transport(Arc::new(InProcess(app)))
}

async fn indexed() -> Arc<ShopSdk> {
    let sdk = sdk().await;
    let job = sdk
        .start_index(IndexRequest {
            query: "phone".into(),
            category: None,
            sources: None,
            max_pages: None,
        })
        .await
        .unwrap();
    for _ in 0..300 {
        let j = sdk.index_job(job.id.clone()).await.unwrap();
        if matches!(
            j.progress.phase,
            Phase::Done | Phase::Failed | Phase::Cancelled
        ) {
            assert_eq!(j.progress.phase, Phase::Done, "{:?}", j.progress);
            return sdk;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("index did not finish");
}

#[tokio::test]
async fn info_categories_and_the_index_job() {
    let sdk = sdk().await;
    let info = sdk.info().await.unwrap();
    assert_eq!(info.mode, ShopMode::Server);
    assert_eq!(info.products, 0);

    let cats = sdk.categories().await.unwrap();
    assert!(cats.iter().any(|c| c.id == "smartphone" && c.builtin));
    let detail = sdk.category("smartphone".into()).await.unwrap();
    assert!(detail
        .resolved
        .criteria
        .as_ref()
        .is_some_and(|c| !c.is_empty()));

    let sdk = indexed().await;
    let jobs = sdk.index_jobs().await.unwrap();
    assert_eq!(jobs.len(), 1);
    let report = jobs[0].report.as_ref().unwrap();
    assert!(report.new_products >= 4);
    assert!(report.sources.contains_key("phones"));
    assert!(sdk.info().await.unwrap().products >= 4);
}

#[tokio::test]
async fn search_compare_and_product_detail() {
    let sdk = indexed().await;
    let res = sdk
        .search(SearchRequest {
            query: "phone".into(),
            category: Some("smartphone".into()),
            profile: None,
            profile_name: None,
            limit: Some(10),
        })
        .await
        .unwrap();
    assert!(res.items.len() >= 3);
    assert!(res.picks.best_overall.is_some());
    assert!(!res.items[0].ranked.breakdown.is_empty());

    let ids: Vec<String> = res
        .items
        .iter()
        .take(2)
        .map(|i| i.product.id.clone())
        .collect();
    let cmp = sdk.compare(ids.clone(), None).await.unwrap();
    assert_eq!(cmp.columns.len(), 2);
    assert!(!cmp.rows.is_empty());

    let detail = sdk.product(ids[0].clone()).await.unwrap();
    assert_eq!(detail.product.id, ids[0]);
    assert_eq!(detail.schema.id, "smartphone");

    let list = sdk
        .products(Some("smartphone".into()), None, None)
        .await
        .unwrap();
    assert!(list.len() >= 4);
    // Attribute values come as JSON text.
    let ram = list
        .iter()
        .find_map(|p| p.attributes.get("ram_gb"))
        .cloned();
    assert!(ram.is_none() || ram.unwrap().is_number());
}

#[tokio::test]
async fn products_can_be_added_edited_and_removed() {
    let sdk = sdk().await;
    let added = sdk
        .add_product(NewProduct {
            category: "smartphone".into(),
            title: "Own Phone".into(),
            brand: Some("Me".into()),
            gtin: None,
            attributes: [("battery_mah".to_string(), json!(4000))].into(),
            offers: vec![Offer {
                shop: "Corner".into(),
                url: "https://shop.test/own".into(),
                price_cents: 30000,
                currency: None,
                shipping_cents: None,
                in_stock: None,
                condition: None,
                list_price_cents: None,
                recurring: None,
                seen_at: None,
            }],
        })
        .await
        .unwrap();
    assert_eq!(added.offers.len(), 1);
    assert_eq!(added.offers[0].currency.as_deref(), Some("EUR"));

    let edited = sdk
        .edit_product(
            added.id.clone(),
            ProductEdit {
                title: Some("Own Phone 2".into()),
                brand: None,
                image: None,
                tags: Some(vec!["mine".into()]),
                attributes: [
                    ("battery_mah".to_string(), serde_json::Value::Null),
                    ("ram_gb".to_string(), json!(6)),
                ]
                .into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(edited.title, "Own Phone 2");
    assert!(!edited.attributes.contains_key("battery_mah"));
    assert_eq!(edited.attributes["ram_gb"].as_f64(), Some(6.0));

    sdk.delete_product(added.id.clone()).await.unwrap();
    let err = sdk.product(added.id).await.unwrap_err();
    assert!(matches!(err, SdkError::Api { status: 404, .. }), "{err:?}");
}

#[tokio::test]
async fn profiles_plans_watches_deals_and_notifications() {
    let sdk = indexed().await;

    let profile = Profile {
        weights: Some([("battery".to_string(), 3.0)].into()),
        constraints: Some(vec![Constraint {
            attribute: "ram_gb".into(),
            op: Op::Gte,
            value: json!(8),
        }]),
        preferences: None,
        max_price_cents: Some(60000),
        horizon_months: None,
        conditions: None,
        in_stock_only: None,
        exclude_brands: None,
        extra_criteria: None,
    };
    let saved = sdk
        .save_profile("work".into(), profile.clone())
        .await
        .unwrap();
    assert_eq!(saved.max_price_cents, Some(60000));
    let named = sdk.profiles().await.unwrap();
    assert!(named.iter().any(|p| p.name == "work"));
    sdk.delete_profile("work".into()).await.unwrap();
    assert!(!sdk
        .profiles()
        .await
        .unwrap()
        .iter()
        .any(|p| p.name == "work"));

    assert!(sdk.my_plan("mobile_plan".into()).await.unwrap().is_none());
    let plan = sdk
        .save_my_plan(
            "mobile_plan".into(),
            MyPlan {
                name: Some("Old".into()),
                monthly_cents: 2999,
                ends_on: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(plan.monthly_cents, 2999);
    assert_eq!(
        sdk.my_plan("mobile_plan".into())
            .await
            .unwrap()
            .unwrap()
            .name
            .as_deref(),
        Some("Old")
    );

    let watch = sdk
        .create_watch(Watch {
            id: None,
            name: "Cheap phone".into(),
            category: Some("smartphone".into()),
            query: Some("phone".into()),
            product_ids: None,
            max_price_cents: Some(25000),
            min_discount_pct: None,
            enabled: None,
        })
        .await
        .unwrap();
    let id = watch.id.unwrap();
    let mut changed = watch.clone();
    changed.max_price_cents = Some(30000);
    assert_eq!(
        sdk.update_watch(id, changed).await.unwrap().max_price_cents,
        Some(30000)
    );
    assert_eq!(sdk.watches().await.unwrap().len(), 1);
    sdk.delete_watch(id).await.unwrap();
    assert!(sdk.watches().await.unwrap().is_empty());

    sdk.deals(None, None).await.unwrap();
    let n = sdk.notifications(None, None).await.unwrap();
    // The cheap phone in the catalogue fires the new watch at once.
    assert_eq!(
        n.unread as usize,
        n.items.iter().filter(|i| !i.read).count()
    );
    let marked = sdk.mark_read(n.last_id).await.unwrap();
    assert_eq!(marked.unread, 0);

    sdk.add_push_token("ExponentPushToken[abc]".into())
        .await
        .unwrap();
    sdk.remove_push_token("ExponentPushToken[abc]".into())
        .await
        .unwrap();
}

#[tokio::test]
async fn a_category_can_be_saved_and_deleted_and_a_bad_one_is_refused_with_reasons() {
    let sdk = sdk().await;
    let schema = CategorySchema {
        id: "garden_tool".into(),
        name: "Garden tool".into(),
        kind: None,
        extends: None,
        keywords: Some(vec!["garden_tool".into()]),
        name_words: None,
        attributes: Some(vec![AttributeDef {
            key: "battery_h".into(),
            label: "Battery".into(),
            kind: Some(AttrKind::Number),
            unit: Some("h".into()),
            aliases: None,
            units: None,
            words: None,
        }]),
        derive: None,
        criteria: Some(vec![
            json!({"key": "battery", "label": "Battery", "kind": "number", "attribute": "battery_h", "weight": 2.0}),
        ]),
        tiers: None,
        remove: None,
    };
    let saved = sdk.save_category(schema.clone()).await.unwrap();
    assert!(saved.customized);
    assert!(sdk
        .categories()
        .await
        .unwrap()
        .iter()
        .any(|c| c.id == "garden_tool"));
    sdk.delete_category("garden_tool".into()).await.unwrap();
    assert!(!sdk
        .categories()
        .await
        .unwrap()
        .iter()
        .any(|c| c.id == "garden_tool"));

    let mut bad = schema;
    bad.criteria = Some(vec![
        json!({"key": "x", "label": "X", "kind": "number", "attribute": "nope"}),
    ]);
    let err = sdk.save_category(bad).await.unwrap_err();
    assert!(
        matches!(
            err,
            SdkError::Api {
                status: 400 | 422,
                ..
            }
        ),
        "{err:?}"
    );
}
