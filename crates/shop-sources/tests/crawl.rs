use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use financer_prices::{FakeHttp, PoliteHttp};
use financer_shop_core::{AttrValue, Registry};
use financer_shop_sources::testing::MemoryStore;
use financer_shop_sources::*;

fn product_page(title: &str, price: &str, extra: &str) -> String {
    format!(
        r#"<html><script type="application/ld+json">{{"@type":"Product","name":"{title}","brand":"Google",
        "offers":{{"@type":"Offer","price":"{price}","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}}}</script>
        <table><tr><th>Akkukapazität</th><td>4700 mAh</td></tr><tr><th>Farbe</th><td>schwarz</td></tr>{extra}</table></html>"#
    )
}

fn sources() -> Vec<SourceConfig> {
    parse_sources(
        r#"[
          {"name": "shop", "kind": "search", "search_url": "https://shop.test/search?q={query}",
           "follow": ["/p/"], "max_depth": 1, "category": "smartphone", "queries": ["pixel"]},
          {"name": "feed", "kind": "feed", "feed_url": "https://feed.test/all.csv", "category": "smartphone",
           "mapping": {"title": "name", "price": "price", "url": "link", "brand": "brand"}}
        ]"#,
    )
    .unwrap()
}

fn http() -> Arc<FakeHttp> {
    let listing = r#"<html>
        <a href="/p/pixel-9">Pixel 9</a> <a href="/p/pixel-8">Pixel 8</a> <a href="/about">About</a>
        <a href="https://other.test/p/x">elsewhere</a></html>"#;
    Arc::new(FakeHttp::with(vec![
        ("https://shop.test/search?q=pixel", 200, listing),
        ("https://shop.test/p/pixel-9", 200, &product_page("Google Pixel 9 128GB", "649.00", "")),
        ("https://shop.test/p/pixel-8", 200, &product_page("Google Pixel 8 128GB", "399.00", "")),
        (
            "https://feed.test/all.csv",
            200,
            "name,price,link,brand,Akku\nGoogle Pixel 9 128GB,639.00,https://feed.test/1,Google,4700 mAh\nSamsung Galaxy S25,799.00,https://feed.test/2,Samsung,4000 mAh\n",
        ),
    ]))
}

fn crawler(http: Arc<FakeHttp>) -> Crawler {
    Crawler::new(http, Arc::new(RwLock::new(Registry::builtin())), sources()).with_clock(|| 1_000)
}

fn request(q: &str) -> IndexRequest {
    IndexRequest {
        query: q.into(),
        ..IndexRequest::default()
    }
}

#[tokio::test]
async fn an_on_demand_run_follows_listing_links_reads_feeds_and_reports_progress() {
    let http = http();
    let store = MemoryStore::default();
    let (tx, rx) = ProgressTx::new();
    let report = crawler(http.clone())
        .index_query(&store, &request("pixel"), &tx, &Cancel::new())
        .await;

    // listing + 2 product pages + the feed; /about and the other host are not followed
    assert_eq!(report.pages, 4, "{report:?}");
    assert_eq!(report.failed, 0);
    let log = http.log.lock().unwrap().clone();
    assert!(!log
        .iter()
        .any(|u| u.contains("/about") || u.contains("other.test")));

    // Pixel 9 exists on the shop and in the feed under the same id: one product, two offers
    let ids = store.ids();
    assert_eq!(
        ids,
        [
            "smartphone:google-pixel-8-128-gb",
            "smartphone:google-pixel-9-128-gb"
        ],
        "the Galaxy is not about pixels"
    );
    let pixel9 = store.product("smartphone:google-pixel-9-128-gb").unwrap();
    assert_eq!(pixel9.offers.len(), 2);
    assert_eq!(pixel9.attributes["battery_mah"], AttrValue::Num(4700.0));
    assert_eq!(report.new_products, 2);
    assert_eq!(report.unchanged, 1); // the feed's Pixel 9 row is a second offer for a known product

    assert_eq!(report.unclaimed_labels, [("Farbe".to_string(), 2)]);
    let last = rx.borrow().clone();
    assert_eq!(last.phase, Phase::Done);
    assert_eq!((last.percent, last.done, last.total), (100, 4, 4));
    assert_eq!(last.products, 3);
    assert_eq!(report.sources["shop"].products, 2);
    assert_eq!(report.sources["feed"].products, 1);
}

#[tokio::test]
async fn a_cancelled_run_stops_before_reading_anything() {
    let store = MemoryStore::default();
    let (tx, rx) = ProgressTx::new();
    let cancel = Cancel::new();
    cancel.cancel();
    let report = crawler(http())
        .index_query(&store, &request("pixel"), &tx, &cancel)
        .await;
    assert!(report.cancelled);
    assert_eq!(report.pages, 0);
    assert_eq!(rx.borrow().phase, Phase::Cancelled);
    assert!(store.ids().is_empty());
}

#[tokio::test]
async fn one_dead_source_does_not_stop_the_others_but_all_dead_is_a_failure() {
    let http = http();
    http.routes
        .lock()
        .unwrap()
        .remove("https://shop.test/search?q=pixel");
    let store = MemoryStore::default();
    let (tx, rx) = ProgressTx::new();
    let report = crawler(http.clone())
        .index_query(&store, &request("pixel"), &tx, &Cancel::new())
        .await;
    assert_eq!(report.failed, 1);
    assert!(report.sources["shop"]
        .last_error
        .as_deref()
        .unwrap()
        .contains("404"));
    assert_eq!(rx.borrow().phase, Phase::Done);
    assert_eq!(store.ids().len(), 1);

    http.routes
        .lock()
        .unwrap()
        .remove("https://feed.test/all.csv");
    let (tx, rx) = ProgressTx::new();
    crawler(http)
        .index_query(
            &MemoryStore::default(),
            &request("pixel"),
            &tx,
            &Cancel::new(),
        )
        .await;
    assert_eq!(rx.borrow().phase, Phase::Failed);
}

#[tokio::test]
async fn the_page_budget_is_respected() {
    let http = http();
    let (tx, _rx) = ProgressTx::new();
    let req = IndexRequest {
        max_pages: Some(2),
        ..request("pixel")
    };
    let report = crawler(http)
        .index_query(&MemoryStore::default(), &req, &tx, &Cancel::new())
        .await;
    assert_eq!(report.pages, 2, "{report:?}");
}

#[tokio::test]
async fn sources_can_be_chosen_and_categories_must_fit() {
    let store = MemoryStore::default();
    let (tx, _rx) = ProgressTx::new();
    let only_feed = IndexRequest {
        sources: Some(vec!["feed".into()]),
        ..request("galaxy")
    };
    let report = crawler(http())
        .index_query(&store, &only_feed, &tx, &Cancel::new())
        .await;
    assert_eq!(report.pages, 1);
    assert_eq!(store.ids(), ["smartphone:samsung-galaxy-s-25"]);
    assert_eq!(
        store
            .product("smartphone:samsung-galaxy-s-25")
            .unwrap()
            .attributes["ecosystem"],
        AttrValue::List(vec!["samsung".into(), "android".into()])
    );

    // a laptop search skips smartphone-only sources altogether
    let (tx, _rx) = ProgressTx::new();
    let report = crawler(http())
        .index_query(
            &MemoryStore::default(),
            &request("laptop"),
            &tx,
            &Cancel::new(),
        )
        .await;
    assert_eq!(report.pages, 0);
}

#[tokio::test]
async fn the_continuous_crawl_discovers_pages_revisits_them_and_notices_price_moves() {
    let http = http();
    let now = Arc::new(AtomicI64::new(1_000_000));
    let clock = now.clone();
    let c = Crawler::new(
        http.clone(),
        Arc::new(RwLock::new(Registry::builtin())),
        sources(),
    )
    .with_clock(move || clock.load(Ordering::SeqCst));
    let store = MemoryStore::default();

    c.seed(&store).await.unwrap();
    c.seed(&store).await.unwrap(); // seeding twice adds nothing
    assert_eq!(store.frontier.lock().unwrap().len(), 2); // the standing search and the feed

    let first = c.run_due(&store, 50).await.unwrap();
    assert_eq!(first.visited, 2);
    assert_eq!(
        store.frontier.lock().unwrap().len(),
        4,
        "the listing's two product pages were discovered"
    );

    let second = c.run_due(&store, 50).await.unwrap();
    assert_eq!(second.visited, 2);
    assert_eq!(
        store.ids().len(),
        3,
        "pixel 8 and 9 from the shop plus the galaxy from the feed"
    );

    // nothing is due until the intervals pass
    assert_eq!(c.run_due(&store, 50).await.unwrap().visited, 0);

    // a day later the Pixel 9 is cheaper
    http.routes.lock().unwrap().insert(
        "https://shop.test/p/pixel-9".into(),
        Ok(financer_prices::HttpResponse {
            status: 200,
            body: product_page("Google Pixel 9 128GB", "549.00", ""),
        }),
    );
    now.fetch_add(40 * 3600, Ordering::SeqCst);
    let third = c.run_due(&store, 50).await.unwrap();
    assert!(third.visited >= 3);
    assert_eq!(third.price_changes, 1);
    let page = store
        .frontier
        .lock()
        .unwrap()
        .get("https://shop.test/p/pixel-9")
        .cloned()
        .unwrap();
    assert_eq!(
        page.interval_secs,
        18 * 3600,
        "a moving price is revisited sooner (36 h before)"
    );
    let quiet = store
        .frontier
        .lock()
        .unwrap()
        .get("https://shop.test/p/pixel-8")
        .cloned()
        .unwrap();
    assert_eq!(
        quiet.interval_secs,
        54 * 3600,
        "a steady price is revisited later"
    );
}

#[tokio::test]
async fn failing_pages_back_off() {
    let http = http();
    let c = crawler(http.clone());
    let store = MemoryStore::default();
    c.seed(&store).await.unwrap();
    http.routes.lock().unwrap().clear();
    let r = c.run_due(&store, 10).await.unwrap();
    assert_eq!((r.visited, r.failed), (2, 2));
    let f = store
        .frontier
        .lock()
        .unwrap()
        .get("https://feed.test/all.csv")
        .cloned()
        .unwrap();
    assert_eq!(f.fails, 1);
    assert_eq!(f.next_at, 1_000 + 48 * 3600);
}

#[tokio::test]
async fn sitemaps_feed_the_frontier_with_matching_urls_only() {
    let http = Arc::new(FakeHttp::with(vec![
        (
            "https://big.test/sitemap.xml",
            200,
            "<urlset><url><loc>https://big.test/p/a</loc></url><url><loc>https://big.test/blog/x</loc></url></urlset>",
        ),
        ("https://big.test/p/a", 200, &product_page("Google Pixel 7", "299.00", "")),
    ]));
    let sources = parse_sources(
        r#"[{"name": "big", "kind": "sitemap", "sitemap_url": "https://big.test/sitemap.xml", "follow": ["/p/"], "category": "smartphone", "max_depth": 1}]"#,
    )
    .unwrap();
    let c = Crawler::new(http, Arc::new(RwLock::new(Registry::builtin())), sources)
        .with_clock(|| 5_000);
    let store = MemoryStore::default();
    c.seed(&store).await.unwrap();
    c.run_due(&store, 10).await.unwrap();
    assert!(store
        .frontier
        .lock()
        .unwrap()
        .contains_key("https://big.test/p/a"));
    assert!(!store
        .frontier
        .lock()
        .unwrap()
        .contains_key("https://big.test/blog/x"));
    c.run_due(&store, 10).await.unwrap();
    assert_eq!(store.ids(), ["smartphone:google-pixel-7"]);
}

#[tokio::test]
async fn robots_txt_is_obeyed() {
    let fake = FakeHttp::with(vec![
        (
            "https://shop.test/robots.txt",
            200,
            "User-agent: *\nDisallow: /search\n",
        ),
        ("https://shop.test/search?q=pixel", 200, "<html></html>"),
        ("https://feed.test/all.csv", 404, ""),
    ]);
    let polite = Arc::new(PoliteHttp::new(fake, "financer", Duration::ZERO));
    let c = Crawler::new(
        polite,
        Arc::new(RwLock::new(Registry::builtin())),
        sources(),
    );
    let (tx, _rx) = ProgressTx::new();
    let report = c
        .index_query(
            &MemoryStore::default(),
            &request("pixel"),
            &tx,
            &Cancel::new(),
        )
        .await;
    assert!(
        report.sources["shop"]
            .last_error
            .as_deref()
            .unwrap()
            .contains("robots.txt"),
        "{report:?}"
    );
}

#[tokio::test]
async fn pages_without_structured_data_are_read_by_the_model_only_when_asked() {
    use financer_llm::MockProvider;
    let page = "<html><h1>Fairphone 5</h1><p>Jetzt 599,00 €</p></html>";
    let answer = r#"{"products":[{"title":"Fairphone 5","brand":"Fairphone","price":"599,00","currency":"EUR","specs":{}}]}"#;
    let sources = |use_llm: bool| {
        parse_sources(&format!(r#"[{{"name": "plain", "urls": ["https://plain.test/fp5"], "category": "smartphone", "use_llm": {use_llm}}}]"#)).unwrap()
    };
    let http = Arc::new(FakeHttp::with(vec![("https://plain.test/fp5", 200, page)]));
    let registry = Arc::new(RwLock::new(Registry::builtin()));

    let without = Crawler::new(http.clone(), registry.clone(), sources(false)).with_reader(
        Arc::new(LlmReader::new(Arc::new(MockProvider::with_answers(vec![
            Ok(answer.into()),
        ])))),
    );
    let store = MemoryStore::default();
    let (tx, _rx) = ProgressTx::new();
    without
        .index_query(&store, &request("fairphone"), &tx, &Cancel::new())
        .await;
    assert!(store.ids().is_empty());

    let with = Crawler::new(http, registry, sources(true)).with_reader(Arc::new(LlmReader::new(
        Arc::new(MockProvider::with_answers(vec![Ok(answer.into())])),
    )));
    let (tx, _rx) = ProgressTx::new();
    with.index_query(&store, &request("fairphone"), &tx, &Cancel::new())
        .await;
    assert_eq!(store.ids(), ["smartphone:fairphone-5"]);
}
