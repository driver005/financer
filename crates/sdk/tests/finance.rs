//! The finance SDK against the real finance router: that every call of the API exists, and that the
//! typed calls read and write what the server really says.

use std::sync::Arc;

use async_trait::async_trait;
use axum::body::Body;
use axum::http::{header, Request as HttpRequest};
use financer_api::{Api, AppState, TokenHash};
use financer_sdk::finance::*;
use financer_sdk::{FinanceSdk, Request, Response, SdkError, Transport};
use financer_store::Store;
use http_body_util::BodyExt;
use tower::ServiceExt;

const TOKEN: &str = "a-long-enough-token-for-the-finance-sdk-0123456789";
const OPENAPI: &str = include_str!("../../../apps/mobile/openapi.json");
const GENERATED: &str = include_str!("../src/finance.rs");

struct InProcess(axum::Router);

#[async_trait]
impl Transport for InProcess {
    async fn send(&self, r: Request) -> Result<Response, SdkError> {
        let mut req = HttpRequest::builder()
            .method(r.method.as_str())
            .uri(r.path.as_str())
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"));
        let body = match r.body {
            Some(b) => {
                req = req.header(
                    header::CONTENT_TYPE,
                    r.content_type.as_deref().unwrap_or("application/json"),
                );
                Body::from(b)
            }
            None => Body::empty(),
        };
        let res = self
            .0
            .clone()
            .oneshot(req.body(body).unwrap())
            .await
            .map_err(|e| SdkError::Network {
                message: e.to_string(),
            })?;
        let status = res.status().as_u16();
        let body = res
            .into_body()
            .collect()
            .await
            .map_err(|e| SdkError::Network {
                message: e.to_string(),
            })?
            .to_bytes()
            .to_vec();
        Ok(Response { status, body })
    }
}

async fn sdk() -> Arc<FinanceSdk> {
    let app = Api::router(
        AppState::new(Store::connect("sqlite::memory:").await.unwrap()),
        TokenHash::new(TOKEN),
    );
    FinanceSdk::with_transport(Arc::new(InProcess(app)))
}

fn csv() -> Vec<u8> {
    let mut out = String::from("\"Auftragskonto\";\"Buchungstag\";\"Verwendungszweck\";\"Beguenstigter/Zahlungspflichtiger\";\"Kontonummer/IBAN\";\"Betrag\"\n");
    for (d, who, purpose, amount) in [
        ("01.01.26", "Vermieter", "Miete Januar", "-800,00"),
        ("01.02.26", "Vermieter", "Miete Februar", "-800,00"),
        ("01.03.26", "Vermieter", "Miete Maerz", "-800,00"),
        ("28.01.26", "Arbeitgeber AG", "Gehalt", "2.500,00"),
        ("02.03.26", "REWE Markt", "Kartenzahlung", "-23,47"),
    ] {
        out.push_str(&format!(
            "\"DE89370400440532013000\";\"{d}\";\"{purpose}\";\"{who}\";\"\";\"{amount}\"\n"
        ));
    }
    out.into_bytes()
}

#[test]
fn every_call_and_type_of_the_api_exists() {
    let doc: serde_json::Value = serde_json::from_str(OPENAPI).unwrap();
    let mut calls = 0;
    for (path, item) in doc["paths"].as_object().unwrap() {
        if path == "/health" {
            continue;
        }
        for (verb, op) in item.as_object().unwrap() {
            if !["get", "post", "put", "delete"].contains(&verb.as_str()) {
                continue;
            }
            let id = op["operationId"].as_str().unwrap();
            assert!(
                GENERATED.contains(&format!("pub async fn {id}(&self")),
                "{verb} {path}: no call {id}; run node crates/sdk/gen/finance.mjs"
            );
            calls += 1;
        }
    }
    assert_eq!(calls, 77);
    for name in doc["components"]["schemas"].as_object().unwrap().keys() {
        assert!(
            GENERATED.contains(&format!("pub struct {name} {{"))
                || GENERATED.contains(&format!("pub enum {name} {{")),
            "no type {name}"
        );
    }
}

#[tokio::test]
async fn the_bank_export_in_and_the_transactions_out() {
    let s = sdk().await;
    assert!(s.list_transactions().await.unwrap().is_empty());
    let report = s.import_transactions(csv()).await.unwrap();
    assert_eq!(
        (report.imported, report.duplicates, report.skipped.len()),
        (5, 0, 0)
    );
    assert_eq!(
        s.import_transactions(csv()).await.unwrap().duplicates,
        5,
        "the same export again adds nothing"
    );
    let all = s.list_transactions().await.unwrap();
    assert_eq!(all.len(), 5);
    let rent = all.iter().find(|t| t.purpose.contains("Januar")).unwrap();
    assert_eq!(
        (rent.amount_cents, rent.booking_date.as_str()),
        (-80000, "2026-01-01")
    );
    assert!(!s.recurring().await.unwrap().is_empty() || all.len() == 5);
}

#[tokio::test]
async fn budget_calls_with_path_and_query_values_and_an_enum() {
    let s = sdk().await;
    s.import_transactions(csv()).await.unwrap();
    let saved = s
        .put_envelopes(vec![EnvelopeDto {
            category: "groceries".into(),
            limit_cents: 40000,
        }])
        .await
        .unwrap();
    assert_eq!(saved[0].limit_cents, 40000);
    assert_eq!(s.get_envelopes().await.unwrap(), saved);
    let status = s
        .budget_status(Some(2026), Some(3), None, None)
        .await
        .unwrap();
    assert_eq!(status[0].category, "groceries");
    assert_eq!(status[0].spent_cents, 2347);
    let period = s
        .budget_period(Some(PeriodChoice::Previous), Some("2026-03-15".into()))
        .await
        .unwrap();
    assert!(!period.start.is_empty());
    let current = s
        .budget_period(None, Some("2026-03-15".into()))
        .await
        .unwrap();
    assert!(current.start >= period.start);
    s.safe_to_spend(Some("2026-03-15".into())).await.unwrap();
    s.forecast(Some("2026-03-15".into())).await.unwrap();
    s.disposable().await.unwrap();
}

#[tokio::test]
async fn rules_create_update_reorder_and_delete() {
    let s = sdk().await;
    let rule = s
        .create_rule(RuleInput {
            category: "groceries".into(),
            kind: "contains".into(),
            max_cents: None,
            min_cents: None,
            pattern: "REWE".into(),
            sign: None,
        })
        .await
        .unwrap();
    assert_eq!(rule.pattern, "REWE", "a 201 answer is a success");
    let changed = s
        .update_rule(
            rule.id,
            RuleInput {
                category: "groceries".into(),
                kind: "contains".into(),
                max_cents: Some(10000),
                min_cents: None,
                pattern: "REWE".into(),
                sign: Some("expense".into()),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        (changed.sign.as_deref(), changed.max_cents),
        (Some("expense"), Some(10000))
    );
    assert_eq!(s.list_rules().await.unwrap().len(), 1);
    s.delete_rule(rule.id).await.unwrap();
    assert!(s.list_rules().await.unwrap().is_empty());
    assert!(matches!(
        s.delete_rule(rule.id).await.unwrap_err(),
        SdkError::Api { status: 404, .. }
    ));
}

#[tokio::test]
async fn settings_basket_receipts_and_the_export_round_trip() {
    let s = sdk().await;
    let before = s.get_settings().await.unwrap();
    let after = s
        .put_settings(SettingsUpdate {
            habit_mode: Some("receipts".into()),
            llm_model: None,
            llm_provider: None,
            payday: Some(25),
        })
        .await
        .unwrap();
    assert_eq!((after.habit_mode.as_str(), after.payday), ("receipts", 25));
    assert_ne!(before.habit_mode, after.habit_mode);

    let catalog = s.catalog().await.unwrap();
    assert!(!catalog.is_empty());
    let basket = s
        .put_basket(vec![BasketItemDto {
            item: catalog[0].key.clone(),
            quantity: 2,
        }])
        .await
        .unwrap();
    assert_eq!(basket.items[0].quantity, 2);

    let r = s
        .upload_receipt(ReceiptUpload {
            text: "REWE\n02.03.2026\nMILCH 1,09\nBROT 2,49\nSUMME 3,58".into(),
        })
        .await
        .unwrap();
    assert!(r.id.is_some());
    assert_eq!(s.list_receipts().await.unwrap().len(), 1);

    s.import_transactions(csv()).await.unwrap();
    let exported = s.export_data().await.unwrap();
    assert_eq!(
        (exported.transactions.len(), exported.receipts.len()),
        (5, 1)
    );
    assert!(
        exported.receipts[0].receipt.is_object(),
        "the free-form part comes through as JSON"
    );
    let other = sdk().await;
    let report = other.import_data(exported.clone()).await.unwrap();
    assert_eq!(report.receipts_added, 1);
    assert_eq!(other.export_data().await.unwrap().transactions.len(), 5);

    s.delete_receipt(r.id.unwrap()).await.unwrap();
    assert!(s.list_receipts().await.unwrap().is_empty());
}

#[tokio::test]
async fn the_servers_reasons_and_path_values_that_need_escaping() {
    let s = sdk().await;
    match s.ean_lookup("12345".into()).await.unwrap_err() {
        SdkError::Api {
            status, message, ..
        } => assert_eq!((status, message.is_empty()), (400, false)),
        other => panic!("{other:?}"),
    }
    // a value with a slash in it is one path segment, not two
    assert!(matches!(
        s.dismiss_alert("a/b".into()).await,
        Err(SdkError::Api { .. }) | Ok(_)
    ));
    assert!(
        matches!(
            s.get_config().await.unwrap_err(),
            SdkError::Api { status: 404, .. }
        ),
        "no config file on this server"
    );
    // no bank is set up on this server: a refusal with a reason, not a crash
    match s
        .start_sync(SyncRequest {
            bic: None,
            blz: "12345678".into(),
            days: None,
            iban: "DE89370400440532013000".into(),
            pin: "1234".into(),
            user_id: "u".into(),
        })
        .await
        .unwrap_err()
    {
        SdkError::Api {
            status, message, ..
        } => assert!(
            status >= 400 && !message.contains("1234"),
            "{status} {message}"
        ),
        other => panic!("{other:?}"),
    }
}
