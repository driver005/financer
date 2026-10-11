//! Export and import of your data: backups, and moving between a hosted server and the phone.

use std::collections::HashSet;

use axum::extract::State;
use axum::Json;
use financer_core::{BasketItem, Budget, Catalog, Money, Transaction};
use financer_receipts::ParsedReceipt;

use crate::dto::*;
use crate::routes::ApiError;
use crate::AppState;

const FORMAT_VERSION: u32 = 1;
const MAX_ITEMS: usize = 200_000;

/// Handlers' real logic; the free functions below are thin shims because `#[utoipa::path]`
/// cannot annotate methods.
pub struct ExportRoutes;

/// Download everything that is yours as one JSON document (no secrets, no prices).
#[utoipa::path(get, path = "/v1/export", responses((status = 200, body = ExportDto)), security(("bearer" = [])))]
pub async fn export_data(State(state): State<AppState>) -> Result<Json<ExportDto>, ApiError> {
    ExportRoutes::export_data(state).await
}

/// Merge an export into this backend. Transactions and receipts already present (same
/// fingerprint) are skipped, so importing twice changes nothing. The budget and your usual-items
/// list replace the current ones when the export has any; settings are applied if present.
#[utoipa::path(post, path = "/v1/import", request_body = ExportDto, responses(
    (status = 200, body = ImportReportDto),
    (status = 400, description = "Not a valid export", body = ErrorBody)), security(("bearer" = [])))]
pub async fn import_data(
    State(state): State<AppState>,
    Json(data): Json<ExportDto>,
) -> Result<Json<ImportReportDto>, ApiError> {
    ExportRoutes::import_data(state, data).await
}

impl ExportRoutes {
    pub async fn export_data(state: AppState) -> Result<Json<ExportDto>, ApiError> {
        let store = &state.store;
        let transactions = store
            .list_transactions()
            .await?
            .into_iter()
            .map(|s| {
                let t = s.transaction;
                ExportTransaction {
                    booking_date: t.booking_date,
                    amount_cents: t.amount,
                    counterparty: t.counterparty,
                    purpose: t.purpose,
                    counterparty_iban: t.counterparty_iban,
                    category: t.category,
                }
            })
            .collect();
        let budget = store
            .load_budget()
            .await?
            .envelopes
            .into_iter()
            .map(|(category, limit)| EnvelopeDto {
                category,
                limit_cents: limit,
            })
            .collect();
        let basket = store
            .usual_items()
            .await?
            .into_iter()
            .map(|i| BasketItemDto {
                item: i.item,
                quantity: i.quantity,
            })
            .collect();
        let receipts = store
            .list_receipts()
            .await?
            .into_iter()
            .filter_map(|r| {
                serde_json::from_str(&r.json)
                    .ok()
                    .map(|receipt| ExportReceipt {
                        fingerprint: r.fingerprint,
                        receipt,
                    })
            })
            .collect();
        Ok(Json(ExportDto {
            version: FORMAT_VERSION,
            transactions,
            budget,
            basket,
            receipts,
            settings: ExportSettings {
                habit_mode: store.get_setting("habit_mode").await?,
                llm_provider: store.get_setting("llm_provider").await?,
                llm_model: store.get_setting("llm_model").await?,
            },
        }))
    }

    pub async fn import_data(
        state: AppState,
        data: ExportDto,
    ) -> Result<Json<ImportReportDto>, ApiError> {
        if data.version != FORMAT_VERSION {
            return Err(ApiError::BadRequest(format!(
                "unsupported export version {} (expected {FORMAT_VERSION})",
                data.version
            )));
        }
        if data.transactions.len() > MAX_ITEMS || data.receipts.len() > MAX_ITEMS {
            return Err(ApiError::BadRequest("export is too large".into()));
        }

        // validate everything first so a bad file changes nothing
        let mut budget = Budget::default();
        for e in &data.budget {
            if e.limit_cents.is_negative()
                || budget.envelopes.insert(e.category, e.limit_cents).is_some()
            {
                return Err(ApiError::BadRequest(
                    "budget has a negative limit or a repeated category".into(),
                ));
            }
        }
        let mut seen = HashSet::new();
        for i in &data.basket {
            if Catalog::by_key(&i.item).is_none()
                || !(1..=99).contains(&i.quantity)
                || !seen.insert(i.item.clone())
            {
                return Err(ApiError::BadRequest(format!(
                    "basket item {:?} is unknown, repeated or has a bad quantity",
                    i.item
                )));
            }
        }
        let mut receipts = Vec::new();
        for r in &data.receipts {
            let parsed: ParsedReceipt = serde_json::from_value(r.receipt.clone())
                .map_err(|_| ApiError::BadRequest("a receipt in the export is malformed".into()))?;
            if r.fingerprint.trim().is_empty() {
                return Err(ApiError::BadRequest("a receipt has no fingerprint".into()));
            }
            receipts.push((r.fingerprint.clone(), parsed));
        }
        if let Some(m) = &data.settings.habit_mode {
            if !["manual", "receipts", "spending"].contains(&m.as_str()) {
                return Err(ApiError::BadRequest(
                    "habit_mode must be manual, receipts or spending".into(),
                ));
            }
        }

        let txs: Vec<Transaction> = data
            .transactions
            .into_iter()
            .map(|t| Transaction {
                booking_date: t.booking_date,
                amount: Money::from_cents(t.amount_cents.cents()),
                counterparty: t.counterparty,
                purpose: t.purpose,
                counterparty_iban: t.counterparty_iban,
                category: t.category,
            })
            .collect();
        let store = &state.store;
        let transactions_added = store.insert_new_transactions(&txs).await?;

        let mut receipts_added = 0;
        for (fingerprint, parsed) in &receipts {
            let json = serde_json::to_string(parsed).map_err(|_| ApiError::Internal)?;
            if store
                .add_receipt(fingerprint, parsed.date, parsed.merchant.as_deref(), &json)
                .await?
                .is_some()
            {
                receipts_added += 1;
            }
        }
        if !data.budget.is_empty() {
            store.save_budget(&budget).await?;
        }
        let basket: Vec<BasketItem> = data
            .basket
            .into_iter()
            .map(|i| BasketItem {
                item: i.item,
                quantity: i.quantity,
            })
            .collect();
        if !basket.is_empty() {
            store.set_usual_items(&basket).await?;
        }
        for (key, value) in [
            ("habit_mode", data.settings.habit_mode.as_deref()),
            ("llm_provider", data.settings.llm_provider.as_deref()),
            ("llm_model", data.settings.llm_model.as_deref()),
        ] {
            if let Some(v) = value {
                store.set_setting(key, v).await?;
            }
        }
        Ok(Json(ImportReportDto {
            transactions_added,
            transactions_known: txs.len() - transactions_added,
            receipts_added,
            receipts_known: receipts.len() - receipts_added,
            budget_envelopes: budget.envelopes.len(),
            basket_items: basket.len(),
        }))
    }
}
