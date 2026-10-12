use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::Router;
use financer_api::{Api, AppState, TokenHash};
use financer_core::{Category, Chain, Money, PriceQuote, Transaction};
use financer_store::{Store, StoredMealDay, StoredQuote};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use time::macros::date;
use tower::ServiceExt;

const TOKEN: &str = "test-token";
/// A Monday; the plan below lives in the week 2026-10-12 to 2026-10-18.
const WEEK: &str = "2026-10-12";

/// An in-memory app and request helpers.
struct Fixture;

impl Fixture {
    fn quote(item: &str, chain: Chain, cents: i64) -> StoredQuote {
        StoredQuote {
            quote: PriceQuote {
                item: item.into(),
                chain,
                price: Money::from_cents(cents),
                valid_until: None,
                is_offer: false,
            },
            product_name: item.into(),
            shelf_price: Money::from_cents(cents),
            source: "test".into(),
            fetched_at: 1_800_000_000,
        }
    }

    async fn store_with(quotes: &[StoredQuote]) -> Store {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        store
            .replace_quotes(&["test".to_string()], quotes)
            .await
            .unwrap();
        store
    }

    fn app_on(store: Store) -> Router {
        Api::router(AppState::new(store), TokenHash::new(TOKEN))
    }

    async fn app(quotes: &[StoredQuote]) -> Router {
        Fixture::app_on(Fixture::store_with(quotes).await)
    }

    async fn send(
        app: &Router,
        method: Method,
        uri: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder()
            .method(method)
            .uri(uri)
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
        let body = match body {
            Some(b) => {
                req = req.header(header::CONTENT_TYPE, "application/json");
                Body::from(b.to_string())
            }
            None => Body::empty(),
        };
        let res = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    async fn get(app: &Router, uri: &str) -> (StatusCode, Value) {
        Fixture::send(app, Method::GET, uri, None).await
    }

    async fn put_plan(app: &Router, days: Value) -> (StatusCode, Value) {
        Fixture::send(
            app,
            Method::PUT,
            &format!("/v1/meal-plan?week={WEEK}"),
            Some(json!({ "days": days })),
        )
        .await
    }

    async fn list(app: &Router) -> Value {
        let (status, list) = Fixture::get(
            app,
            &format!("/v1/meal-plan/shopping-list?week={WEEK}&date={WEEK}"),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{list}");
        list
    }

    fn names(items: &Value) -> Vec<String> {
        items
            .as_array()
            .unwrap()
            .iter()
            .map(|i| i["name"].as_str().unwrap().to_string())
            .collect()
    }

    fn find<'a>(items: &'a Value, name: &str) -> &'a Value {
        items
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["name"] == name)
            .unwrap_or_else(|| panic!("{name} not in {items}"))
    }
}

/// Custom meal with milk, bread and pasta: 2 packs, 1 pack, 1 pack.
fn milk_bread_pasta() -> Value {
    json!({"date": "2026-10-14", "title": "Milchsuppe", "servings": 2, "ingredients": [
        {"name": "Vollmilch", "amount": "2 l"},
        {"name": "Brot", "amount": "500 g"},
        {"name": "Spaghetti", "amount": "500 g"},
    ]})
}

// ---- the plan ----

#[tokio::test]
async fn a_week_can_be_saved_read_replaced_and_cleared() {
    let app = Fixture::app(&[]).await;

    // empty to begin with; any day of the week names the week
    let (status, plan) = Fixture::get(&app, "/v1/meal-plan?week=2026-10-15").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(plan["week_start"], WEEK);
    assert_eq!(plan["week_end"], "2026-10-18");
    assert_eq!(plan["days"].as_array().unwrap().len(), 0);

    let (status, plan) = Fixture::put_plan(
        &app,
        json!([
            // given out of order on purpose
            {"date": "2026-10-16", "recipe_id": "kartoffelsuppe", "servings": 4},
            {"date": "2026-10-12", "recipe_id": "spaghetti-tomatensosse", "servings": 2},
            {"date": "2026-10-18", "title": "  Reste  ", "servings": 1, "recipe_servings": 2,
             "ingredients": [{"name": "Reis", "amount": "200 g"}]},
        ]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{plan}");
    let days = plan["days"].as_array().unwrap();
    assert_eq!(
        days.iter()
            .map(|d| d["date"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["2026-10-12", "2026-10-16", "2026-10-18"]
    );
    assert_eq!(days[0]["title"], "Spaghetti mit Tomatensoße");
    assert_eq!(days[0]["recipe_servings"], 2);
    assert!(days[0]["ingredients"].as_array().unwrap().len() >= 5);
    assert_eq!(days[1]["servings"], 4);
    assert_eq!(days[2]["title"], "Reste");
    assert_eq!(days[2]["recipe_id"], Value::Null);
    assert_eq!(days[2]["recipe_servings"], 2);
    assert_eq!(days[2]["ingredients"][0]["name"], "Reis");
    assert!(days.iter().all(|d| d["available"] == true));

    // the week is its own: the next week stays empty
    let (_, next) = Fixture::get(&app, "/v1/meal-plan?week=2026-10-19").await;
    assert!(next["days"].as_array().unwrap().is_empty());

    // saving again replaces the whole week
    let (_, plan) = Fixture::put_plan(
        &app,
        json!([{"date": "2026-10-13", "recipe_id": "pfannkuchen", "servings": 3}]),
    )
    .await;
    assert_eq!(plan["days"].as_array().unwrap().len(), 1);
    let (_, again) = Fixture::get(&app, &format!("/v1/meal-plan?week={WEEK}")).await;
    assert_eq!(again["days"][0]["recipe_id"], "pfannkuchen");

    // an empty list clears it
    let (status, cleared) = Fixture::put_plan(&app, json!([])).await;
    assert_eq!(status, StatusCode::OK);
    assert!(cleared["days"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn bad_plans_are_rejected_and_change_nothing() {
    let app = Fixture::app(&[]).await;
    Fixture::put_plan(
        &app,
        json!([{"date": "2026-10-12", "recipe_id": "pfannkuchen", "servings": 2}]),
    )
    .await;

    let custom = |extra: Value| {
        let mut d = json!({"date": "2026-10-13", "title": "X", "servings": 2,
            "ingredients": [{"name": "Reis", "amount": "100 g"}]});
        for (k, v) in extra.as_object().unwrap() {
            d[k] = v.clone();
        }
        json!([d])
    };
    let bad = [
        // unknown recipe
        json!([{"date": "2026-10-13", "recipe_id": "nope", "servings": 2}]),
        // a day outside the week
        json!([{"date": "2026-10-19", "recipe_id": "pfannkuchen", "servings": 2}]),
        json!([{"date": "2026-10-11", "recipe_id": "pfannkuchen", "servings": 2}]),
        // two meals on one day
        json!([
            {"date": "2026-10-13", "recipe_id": "pfannkuchen", "servings": 2},
            {"date": "2026-10-13", "recipe_id": "linsensuppe", "servings": 2},
        ]),
        // servings out of range
        json!([{"date": "2026-10-13", "recipe_id": "pfannkuchen", "servings": 0}]),
        json!([{"date": "2026-10-13", "recipe_id": "pfannkuchen", "servings": 21}]),
        // neither or both of recipe and title
        json!([{"date": "2026-10-13", "servings": 2}]),
        json!([{"date": "2026-10-13", "recipe_id": "pfannkuchen", "title": "X", "servings": 2}]),
        // custom meals need ingredients, sane text and sane servings
        json!([{"date": "2026-10-13", "title": "X", "servings": 2}]),
        json!([{"date": "2026-10-13", "title": "X", "servings": 2, "ingredients": []}]),
        custom(json!({"title": "   "})),
        custom(json!({"title": "A\nB"})),
        custom(json!({"title": "x".repeat(121)})),
        custom(json!({"recipe_servings": 0})),
        custom(json!({"ingredients": [{"name": "", "amount": "1"}]})),
        custom(json!({"ingredients": [{"name": "Reis", "amount": "x".repeat(41)}]})),
        custom(json!({"ingredients": vec![json!({"name": "Reis", "amount": "1"}); 41]})),
        // ingredient fields do not go with a recipe id
        json!([{"date": "2026-10-13", "recipe_id": "pfannkuchen", "servings": 2,
                "ingredients": [{"name": "Reis", "amount": "1"}]}]),
    ];
    for body in bad {
        let (status, err) = Fixture::put_plan(&app, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(err["error"].is_string());
    }

    // more than seven days
    let eight: Vec<Value> = (0..8)
        .map(|_| json!({"date": "2026-10-13", "recipe_id": "pfannkuchen", "servings": 2}))
        .collect();
    let (status, _) = Fixture::put_plan(&app, json!(eight)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // the saved week survived all of that
    let (_, plan) = Fixture::get(&app, &format!("/v1/meal-plan?week={WEEK}")).await;
    assert_eq!(plan["days"].as_array().unwrap().len(), 1);
    assert_eq!(plan["days"][0]["date"], "2026-10-12");

    // bad dates in the query
    let (status, _) = Fixture::get(&app, "/v1/meal-plan?week=not-a-date").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_recipe_that_left_the_dataset_is_flagged_and_skipped() {
    let store = Store::connect("sqlite::memory:").await.unwrap();
    store
        .replace_meal_plan(
            date!(2026 - 10 - 12),
            date!(2026 - 10 - 18),
            &[StoredMealDay {
                date: date!(2026 - 10 - 13),
                recipe_id: Some("removed-recipe".into()),
                title: "Altes Rezept".into(),
                servings: 2,
                base_servings: 2,
                ingredients_json: None,
            }],
        )
        .await
        .unwrap();
    let app = Fixture::app_on(store);
    let (_, plan) = Fixture::get(&app, &format!("/v1/meal-plan?week={WEEK}")).await;
    assert_eq!(plan["days"][0]["title"], "Altes Rezept");
    assert_eq!(plan["days"][0]["available"], false);

    let list = Fixture::list(&app).await;
    assert_eq!(list["meals_planned"], 0);
    assert_eq!(list["skipped_meals"], json!(["Altes Rezept"]));
}

// ---- the shopping list ----

#[tokio::test]
async fn an_empty_week_has_an_empty_list() {
    let app = Fixture::app(&[Fixture::quote("milch", Chain::Aldi, 99)]).await;
    let list = Fixture::list(&app).await;
    assert_eq!(list["week_start"], WEEK);
    assert_eq!(list["meals_planned"], 0);
    assert_eq!(list["plan"], Value::Null);
    assert!(list["per_chain"].as_array().unwrap().is_empty());
    assert!(list["unpriced"].as_array().unwrap().is_empty());
    assert_eq!(list["budget"]["estimated_cents"], 0);
}

#[tokio::test]
async fn ingredients_are_folded_scaled_and_priced_per_chain() {
    let app = Fixture::app(&[
        Fixture::quote("nudeln", Chain::Aldi, 89),
        Fixture::quote("nudeln", Chain::Lidl, 79),
        Fixture::quote("tomaten-passiert", Chain::Lidl, 55),
        Fixture::quote("tomaten-passiert", Chain::Rewe, 99),
    ])
    .await;
    // the same dish twice (2 servings each) and once more for four: 250 g pasta per 2 servings
    let (status, body) = Fixture::put_plan(
        &app,
        json!([
            {"date": "2026-10-12", "recipe_id": "spaghetti-tomatensosse", "servings": 2},
            {"date": "2026-10-13", "recipe_id": "spaghetti-tomatensosse", "servings": 2},
            {"date": "2026-10-14", "recipe_id": "spaghetti-tomatensosse", "servings": 4},
        ]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let list = Fixture::list(&app).await;
    assert_eq!(list["meals_planned"], 3);

    // pasta: 250 + 250 + 500 g = 1 kg = 2 packs of 500 g; sauce: 0.5 + 0.5 + 1 l = 4 packs
    let lidl = &list["plan"]["stops"][0];
    assert_eq!(list["plan"]["stops"].as_array().unwrap().len(), 1);
    assert_eq!(lidl["chain"], "lidl");
    let pasta = Fixture::find(&lidl["items"], "Nudeln");
    assert_eq!(pasta["needed"], "1 kg");
    assert_eq!(pasta["packs"], 2);
    assert_eq!(pasta["pack"], "500 g");
    assert_eq!(pasta["pack_price_cents"], 79);
    assert_eq!(pasta["line_cents"], 158);
    assert_eq!(pasta["meals"], json!(["Spaghetti mit Tomatensoße"]));
    let sauce = Fixture::find(&lidl["items"], "Passierte Tomaten");
    assert_eq!(sauce["needed"], "2 l");
    assert_eq!(sauce["packs"], 4);
    assert_eq!(sauce["line_cents"], 220);
    assert_eq!(lidl["subtotal_cents"], 158 + 220);
    assert_eq!(list["plan"]["total_cents"], 378);
    assert_eq!(list["plan"]["split"], false);

    // per chain: Lidl has both, Aldi lacks the sauce, Rewe lacks the pasta
    let chains = list["per_chain"].as_array().unwrap();
    assert_eq!(chains[0]["chain"], "lidl");
    assert_eq!(chains[0]["complete"], true);
    assert_eq!(chains[0]["total_cents"], 378);
    let aldi = chains.iter().find(|c| c["chain"] == "aldi").unwrap();
    assert_eq!(aldi["complete"], false);
    assert_eq!(aldi["missing"], json!(["Passierte Tomaten"]));

    // no price anywhere for onions and garlic: listed apart, not blocking the plan
    assert_eq!(
        Fixture::names(&list["unpriced"]),
        vec!["Knoblauch", "Zwiebeln"]
    );
    assert_eq!(list["unpriced"][0]["pack_price_cents"], Value::Null);
    assert_eq!(list["budget"]["unpriced_count"], 2);

    // salt and oil are on the default pantry list
    let skipped: Vec<_> = list["pantry_skipped"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["item"].as_str().unwrap())
        .collect();
    assert_eq!(skipped, vec!["oel", "salz"]);
}

#[tokio::test]
async fn splitting_across_chains_needs_a_large_enough_saving() {
    // Aldi alone: 198 + 179 + 89 = 466. Best split: 198 + 99 + 79 = 376, saving 90.
    let quotes = [
        Fixture::quote("milch", Chain::Aldi, 99),
        Fixture::quote("milch", Chain::Rewe, 119),
        Fixture::quote("brot", Chain::Aldi, 179),
        Fixture::quote("brot", Chain::Lidl, 99),
        Fixture::quote("nudeln", Chain::Aldi, 89),
        Fixture::quote("nudeln", Chain::Lidl, 79),
    ];
    let app = Fixture::app(&quotes).await;
    Fixture::put_plan(&app, json!([milk_bread_pasta()])).await;
    let list = Fixture::list(&app).await;
    let plan = &list["plan"];
    assert_eq!(plan["split"], true);
    assert_eq!(plan["total_cents"], 376);
    assert_eq!(plan["single_chain_total_cents"], 466);
    assert_eq!(plan["saving_cents"], 90);
    let stops = plan["stops"].as_array().unwrap();
    assert_eq!(stops.len(), 2);
    let aldi = stops.iter().find(|s| s["chain"] == "aldi").unwrap();
    assert_eq!(Fixture::names(&aldi["items"]), vec!["Milch"]);
    assert_eq!(aldi["items"][0]["packs"], 2);
    assert_eq!(aldi["subtotal_cents"], 198);
    let lidl = stops.iter().find(|s| s["chain"] == "lidl").unwrap();
    assert_eq!(Fixture::names(&lidl["items"]), vec!["Brot", "Nudeln"]);
    assert_eq!(lidl["subtotal_cents"], 99 + 79);

    // a split that would save only 40 cents is not worth a second trip: 466 against 426
    let app = Fixture::app(&[
        Fixture::quote("milch", Chain::Aldi, 99),
        Fixture::quote("brot", Chain::Aldi, 179),
        Fixture::quote("brot", Chain::Lidl, 149),
        Fixture::quote("nudeln", Chain::Aldi, 89),
        Fixture::quote("nudeln", Chain::Lidl, 79),
        Fixture::quote("milch", Chain::Lidl, 400),
    ])
    .await;
    Fixture::put_plan(&app, json!([milk_bread_pasta()])).await;
    let list = Fixture::list(&app).await;
    assert_eq!(list["plan"]["split"], false);
    assert_eq!(list["plan"]["total_cents"], 466);
    assert_eq!(list["plan"]["saving_cents"], 0);
    assert_eq!(list["plan"]["stops"].as_array().unwrap().len(), 1);
    assert_eq!(list["plan"]["stops"][0]["chain"], "aldi");
}

#[tokio::test]
async fn ended_offers_are_not_used() {
    let mut old = Fixture::quote("nudeln", Chain::Aldi, 10);
    old.quote.valid_until = Some(date!(2020 - 01 - 01));
    old.quote.is_offer = true;
    let app = Fixture::app(&[old, Fixture::quote("nudeln", Chain::Lidl, 79)]).await;
    Fixture::put_plan(
        &app,
        json!([{"date": "2026-10-12", "title": "Nudeln", "servings": 2,
                "ingredients": [{"name": "Spaghetti", "amount": "500 g"}]}]),
    )
    .await;
    let list = Fixture::list(&app).await;
    assert_eq!(list["plan"]["total_cents"], 79);
    assert_eq!(list["plan"]["stops"][0]["chain"], "lidl");
}

#[tokio::test]
async fn suggested_recipes_scale_and_unknown_ingredients_are_listed() {
    let app = Fixture::app(&[Fixture::quote("reis", Chain::Aldi, 150)]).await;
    // written for 2, cooked for 6: 3 x 150 g = 450 g rice, still one 1 kg pack
    Fixture::put_plan(
        &app,
        json!([{"date": "2026-10-12", "title": "Reispfanne", "servings": 6, "recipe_servings": 2,
                "ingredients": [
                    {"name": "Basmatireis", "amount": "150 g"},
                    {"name": "Safran", "amount": "1 Prise"},
                    {"name": "Korianderblätter", "amount": "1 Bund"},
                ]},
               {"date": "2026-10-13", "title": "Safranreis", "servings": 2,
                "ingredients": [{"name": "safran", "amount": "2 Fäden"}]}]),
    )
    .await;
    let list = Fixture::list(&app).await;
    let rice = &list["plan"]["stops"][0]["items"][0];
    assert_eq!(rice["name"], "Reis");
    assert_eq!(rice["needed"], "450 g");
    assert_eq!(rice["packs"], 1);
    assert_eq!(rice["pack"], "1 kg");
    let unmatched = list["unmatched"].as_array().unwrap();
    assert_eq!(unmatched.len(), 2);
    let saffron = unmatched.iter().find(|u| u["name"] == "Safran").unwrap();
    assert_eq!(saffron["amounts"], json!(["1 Prise", "2 Fäden"]));
    assert_eq!(saffron["meals"], json!(["Reispfanne", "Safranreis"]));
    assert_eq!(list["budget"]["unpriced_count"], 2);
}

#[tokio::test]
async fn nothing_priced_still_lists_what_to_buy() {
    let app = Fixture::app(&[]).await;
    Fixture::put_plan(
        &app,
        json!([{"date": "2026-10-12", "recipe_id": "rueherei", "servings": 1}]),
    )
    .await;
    let list = Fixture::list(&app).await;
    assert_eq!(list["plan"], Value::Null);
    assert!(list["per_chain"].as_array().unwrap().is_empty());
    assert!(!list["unpriced"].as_array().unwrap().is_empty());
    assert_eq!(list["budget"]["estimated_cents"], 0);
}

// ---- the pantry list ----

#[tokio::test]
async fn pantry_defaults_can_be_edited_and_drive_the_list() {
    let app = Fixture::app(&[Fixture::quote("salz", Chain::Aldi, 49)]).await;
    let (status, pantry) = Fixture::get(&app, "/v1/meal-plan/pantry").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(pantry["is_default"], true);
    let keys: Vec<_> = pantry["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["item"].as_str().unwrap().to_string())
        .collect();
    for k in ["salz", "oel", "mehl", "zucker", "pfeffer"] {
        assert!(keys.contains(&k.to_string()), "{k} missing in {keys:?}");
    }
    assert!(!keys.contains(&"nudeln".to_string()));

    Fixture::put_plan(
        &app,
        json!([{"date": "2026-10-12", "recipe_id": "spaghetti-tomatensosse", "servings": 2}]),
    )
    .await;
    let before = Fixture::list(&app).await;
    assert!(!Fixture::names(&before["unpriced"]).contains(&"Salz".to_string()));
    assert!(before["plan"].is_null());

    // salt is no longer assumed to be at home; oil still is. Duplicates fold.
    let (status, pantry) = Fixture::send(
        &app,
        Method::PUT,
        "/v1/meal-plan/pantry",
        Some(json!({"items": ["oel", "oel", "mehl"]})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(pantry["is_default"], false);
    assert_eq!(
        Fixture::names(&pantry["items"]),
        vec!["Speiseöl", "Weizenmehl"]
    );
    let (_, again) = Fixture::get(&app, "/v1/meal-plan/pantry").await;
    assert_eq!(again["items"], pantry["items"]);

    let after = Fixture::list(&app).await;
    // "salt to taste" needs one pack, and it has a price
    let salt = Fixture::find(&after["plan"]["stops"][0]["items"], "Salz");
    assert_eq!(salt["packs"], 1);
    assert_eq!(salt["line_cents"], 49);
    let skipped: Vec<_> = after["pantry_skipped"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["item"].as_str().unwrap())
        .collect();
    assert_eq!(skipped, vec!["oel"]);

    // an empty list is allowed and is not the default
    let (_, empty) = Fixture::send(
        &app,
        Method::PUT,
        "/v1/meal-plan/pantry",
        Some(json!({"items": []})),
    )
    .await;
    assert_eq!(empty["items"].as_array().unwrap().len(), 0);
    assert_eq!(empty["is_default"], false);
}

#[tokio::test]
async fn pantry_rejects_unknown_items() {
    let app = Fixture::app(&[]).await;
    let (status, err) = Fixture::send(
        &app,
        Method::PUT,
        "/v1/meal-plan/pantry",
        Some(json!({"items": ["salz", "unobtainium"]})),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(err["error"].as_str().unwrap().contains("unobtainium"));
    let (_, pantry) = Fixture::get(&app, "/v1/meal-plan/pantry").await;
    assert_eq!(pantry["is_default"], true); // nothing was saved
}

// ---- the budget check ----

#[tokio::test]
async fn the_total_is_checked_against_what_is_left_of_the_groceries_limit() {
    let store = Fixture::store_with(&[
        Fixture::quote("nudeln", Chain::Lidl, 79),
        Fixture::quote("tomaten-passiert", Chain::Lidl, 55),
    ])
    .await;
    // 120 euro already spent on groceries this period
    store
        .insert_new_transactions(&[Transaction {
            booking_date: date!(2026 - 10 - 05),
            amount: Money::from_cents(-12_000),
            counterparty: "REWE".into(),
            purpose: "Einkauf".into(),
            counterparty_iban: None,
            category: Some(Category::Groceries),
        }])
        .await
        .unwrap();
    let app = Fixture::app_on(store);
    Fixture::put_plan(
        &app,
        json!([{"date": "2026-10-12", "recipe_id": "spaghetti-tomatensosse", "servings": 2}]),
    )
    .await;

    // no groceries limit yet
    let list = Fixture::list(&app).await;
    assert_eq!(list["budget"]["budget_source"], "none");
    assert_eq!(list["budget"]["budget_cents"], Value::Null);
    assert_eq!(list["budget"]["fits"], Value::Null);
    assert_eq!(list["budget"]["estimated_cents"], 79 + 55);

    // 300 euro limit, 120 spent: 180 left, the plan costs 1.34
    Fixture::send(
        &app,
        Method::PUT,
        "/v1/budget/envelopes",
        Some(json!([{"category": "groceries", "limit_cents": 30_000}])),
    )
    .await;
    let list = Fixture::list(&app).await;
    let budget = &list["budget"];
    assert_eq!(budget["budget_source"], "groceries_envelope");
    assert_eq!(budget["budget_cents"], 18_000);
    assert_eq!(budget["estimated_cents"], 134);
    assert_eq!(budget["left_after_cents"], 18_000 - 134);
    assert_eq!(budget["fits"], true);

    // a limit of 125 euro leaves 5 euro; still fits. A limit of 121 leaves 1 euro: over.
    Fixture::send(
        &app,
        Method::PUT,
        "/v1/budget/envelopes",
        Some(json!([{"category": "groceries", "limit_cents": 12_100}])),
    )
    .await;
    let list = Fixture::list(&app).await;
    assert_eq!(list["budget"]["budget_cents"], 100);
    assert_eq!(list["budget"]["left_after_cents"], 100 - 134);
    assert_eq!(list["budget"]["fits"], false);
}

// ---- access ----

#[test]
fn openapi_document_lists_the_meal_plan_routes() {
    let doc: Value = serde_json::from_str(&Api::openapi_json()).unwrap();
    let paths = doc["paths"].as_object().unwrap();
    for p in [
        "/v1/meal-plan",
        "/v1/meal-plan/shopping-list",
        "/v1/meal-plan/pantry",
    ] {
        assert!(paths.contains_key(p), "missing {p}");
    }
    assert!(paths["/v1/meal-plan"]["put"].is_object());
}

#[tokio::test]
async fn meal_plan_routes_need_the_token() {
    let app = Fixture::app(&[]).await;
    for (method, uri) in [
        (Method::GET, "/v1/meal-plan"),
        (Method::PUT, "/v1/meal-plan"),
        (Method::GET, "/v1/meal-plan/shopping-list"),
        (Method::GET, "/v1/meal-plan/pantry"),
        (Method::PUT, "/v1/meal-plan/pantry"),
    ] {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(uri)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED, "{uri}");
    }
}
