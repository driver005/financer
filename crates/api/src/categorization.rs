//! Categorization rules, corrections that teach a rule, split transactions and the LLM
//! fallback for merchants nothing else could place.
//!
//! The LLM fallback sends only distinct, normalized merchant names and the list of allowed
//! categories; never amounts, dates, IBANs or purposes.

use std::collections::{HashMap, HashSet};

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use financer_core::{AmountSign, Category, MatchKind, Money, NameNormalizer, SplitPart, UserRule};
use financer_llm::LlmError;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::dto::{ErrorBody, TransactionDto};
use crate::grocery::Grocery;
use crate::routes::ApiError;
use crate::AppState;

/// A user categorization rule. Rules run in list order; the first match wins and beats the
/// built-in rules.
#[derive(Debug, Serialize, ToSchema)]
pub struct RuleDto {
    pub id: i64,
    /// Compared with the counterparty name after normalization (case, digits and punctuation
    /// are ignored).
    pub pattern: String,
    /// `contains`, `equals` or `starts_with`.
    #[schema(value_type = String, example = "contains")]
    pub kind: MatchKind,
    /// Only expenses (`expense`) or only income (`income`); absent for both.
    #[schema(value_type = Option<String>, example = "expense")]
    pub sign: Option<AmountSign>,
    /// Smallest amount that matches, compared without sign.
    #[schema(value_type = Option<i64>, example = 500)]
    pub min_cents: Option<Money>,
    /// Largest amount that matches, compared without sign.
    #[schema(value_type = Option<i64>, example = 2000)]
    pub max_cents: Option<Money>,
    #[schema(value_type = String, example = "dining")]
    pub category: Category,
}

impl From<UserRule> for RuleDto {
    fn from(r: UserRule) -> Self {
        RuleDto {
            id: r.id,
            pattern: r.pattern,
            kind: r.kind,
            sign: r.sign,
            min_cents: r.min,
            max_cents: r.max,
            category: r.category,
        }
    }
}

/// Fields of a rule when creating or replacing one.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RuleInput {
    pub pattern: String,
    #[schema(value_type = String, example = "contains")]
    pub kind: MatchKind,
    #[serde(default)]
    #[schema(value_type = Option<String>, example = "expense")]
    pub sign: Option<AmountSign>,
    #[serde(default)]
    #[schema(value_type = Option<i64>)]
    pub min_cents: Option<Money>,
    #[serde(default)]
    #[schema(value_type = Option<i64>)]
    pub max_cents: Option<Money>,
    #[schema(value_type = String, example = "dining")]
    pub category: Category,
}

impl RuleInput {
    fn into_rule(self, id: i64) -> UserRule {
        UserRule {
            id,
            pattern: self.pattern,
            kind: self.kind,
            sign: self.sign,
            min: self.min_cents,
            max: self.max_cents,
            category: self.category,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RuleOrder {
    /// Every rule id exactly once, highest priority first.
    pub ids: Vec<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ApplyReport {
    /// Transactions whose category changed. Transactions you categorized by hand are skipped.
    pub changed: usize,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CategoryChange {
    #[schema(value_type = String, example = "groceries")]
    pub category: Category,
    /// Also create (or update) a rule for this merchant and apply it to its other
    /// transactions.
    #[serde(default)]
    pub remember: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CategoryChanged {
    pub transaction: TransactionDto,
    /// The rule that was created or updated when `remember` was set.
    pub rule: Option<RuleDto>,
    /// Other transactions that changed category because of that rule.
    pub others_changed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SplitPartDto {
    /// Same sign as the transaction (negative for an expense).
    #[schema(value_type = i64, example = -1500)]
    pub amount_cents: Money,
    #[schema(value_type = String, example = "shopping")]
    pub category: Category,
    pub note: Option<String>,
}

impl From<SplitPart> for SplitPartDto {
    fn from(p: SplitPart) -> Self {
        SplitPartDto {
            amount_cents: p.amount,
            category: p.category,
            note: p.note,
        }
    }
}

impl From<SplitPartDto> for SplitPart {
    fn from(p: SplitPartDto) -> Self {
        SplitPart {
            amount: p.amount_cents,
            category: p.category,
            note: p.note,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SplitInput {
    /// At least two parts that add up to the transaction amount exactly.
    pub parts: Vec<SplitPartDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SplitDto {
    pub transaction_id: i64,
    pub parts: Vec<SplitPartDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SuggestionDto {
    /// The merchant name as sent (lowercase letters only).
    pub merchant: String,
    #[schema(value_type = String, example = "dining")]
    pub category: Category,
    /// How many of your transactions carry this merchant.
    pub transactions: usize,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SuggestionsDto {
    pub suggestions: Vec<SuggestionDto>,
    /// How many distinct merchant names were sent to the model.
    pub merchants_sent: usize,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AcceptedSuggestion {
    pub merchant: String,
    #[schema(value_type = String, example = "dining")]
    pub category: Category,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AcceptSuggestions {
    pub suggestions: Vec<AcceptedSuggestion>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AcceptReport {
    /// Rules created or updated (one per accepted merchant).
    pub rules_saved: usize,
    /// Transactions that changed category as a result.
    pub transactions_changed: usize,
}

/// The LLM fallback: prompt, answer parsing and the guard rails around the model's answer.
struct Suggester;

impl Suggester {
    /// Most merchants sent in one request.
    const MAX_MERCHANTS: usize = 60;
    const MAX_NAME_CHARS: usize = 60;

    const SYSTEM: &'static str =
        "You sort merchant names from a German bank statement into spending categories. \
Reply only with a JSON object {\"suggestions\":[{\"merchant\":string,\"category\":string}]}. \
Copy each merchant exactly as given. The category must be one of the allowed categories. \
Leave a merchant out when you do not recognise it; never guess.";

    /// Categories the model may pick: spending categories, not income and not the catch-all.
    fn allowed() -> Vec<Category> {
        vec![
            Category::Groceries,
            Category::Dining,
            Category::Transport,
            Category::Housing,
            Category::Utilities,
            Category::Insurance,
            Category::Subscriptions,
            Category::Health,
            Category::Leisure,
            Category::Shopping,
            Category::Cash,
            Category::Savings,
        ]
    }

    fn name(c: Category) -> String {
        match serde_json::to_value(c) {
            Ok(serde_json::Value::String(s)) => s,
            _ => unreachable!("categories serialize to a string"),
        }
    }

    fn is_allowed(c: Category) -> bool {
        Self::allowed().contains(&c)
    }

    /// The user message: the allowed categories and the merchant names. Nothing else.
    fn prompt(merchants: &[String]) -> String {
        let categories: Vec<String> = Self::allowed().into_iter().map(Self::name).collect();
        let mut p = format!(
            "Allowed categories: {}\nMerchants:\n",
            categories.join(", ")
        );
        for m in merchants {
            p.push_str("- ");
            p.push_str(m);
            p.push('\n');
        }
        p
    }

    /// Merchant names that may be sent: normalized (letters and single spaces) and short; a
    /// longer name is not sent at all, so a rule made from a suggestion always matches it.
    fn sendable(name: &str) -> String {
        let n = NameNormalizer::normalize(name);
        if n.chars().count() > Self::MAX_NAME_CHARS {
            String::new()
        } else {
            n
        }
    }

    /// Keep only suggestions for merchants that were actually sent and categories that are
    /// allowed; first answer per merchant wins.
    fn parse(text: &str, sent: &HashSet<String>) -> Result<Vec<(String, Category)>, String> {
        #[derive(Deserialize)]
        struct Answer {
            suggestions: Vec<Entry>,
        }
        #[derive(Deserialize)]
        struct Entry {
            merchant: String,
            category: String,
        }
        let start = text.find('{').ok_or("no JSON object in answer")?;
        let end = text.rfind('}').ok_or("no JSON object in answer")?;
        if end <= start {
            return Err("no JSON object in answer".into());
        }
        let answer: Answer = serde_json::from_str(&text[start..=end]).map_err(|e| e.to_string())?;
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for e in answer.suggestions {
            let merchant = NameNormalizer::normalize(&e.merchant);
            let Ok(category) = serde_json::from_value::<Category>(serde_json::Value::String(
                e.category.trim().to_lowercase(),
            )) else {
                continue;
            };
            if sent.contains(&merchant)
                && Self::is_allowed(category)
                && seen.insert(merchant.clone())
            {
                out.push((merchant, category));
            }
        }
        Ok(out)
    }
}

/// Handlers' real logic; the free functions below are thin shims for `#[utoipa::path]`.
pub struct Categorization;

impl Categorization {
    fn rule_error(e: financer_core::RuleError) -> ApiError {
        ApiError::BadRequest(e.to_string())
    }

    pub async fn list_rules(state: AppState) -> Result<Json<Vec<RuleDto>>, ApiError> {
        Ok(Json(
            state
                .store
                .list_rules()
                .await?
                .into_iter()
                .map(RuleDto::from)
                .collect(),
        ))
    }

    pub async fn create_rule(
        state: AppState,
        input: RuleInput,
    ) -> Result<(StatusCode, Json<RuleDto>), ApiError> {
        let rule = input.into_rule(0);
        rule.validate().map_err(Self::rule_error)?;
        let saved = state.store.add_rule(&rule).await?;
        Ok((StatusCode::CREATED, Json(saved.into())))
    }

    pub async fn update_rule(
        state: AppState,
        id: i64,
        input: RuleInput,
    ) -> Result<Json<RuleDto>, ApiError> {
        let mut rule = input.into_rule(id);
        rule.validate().map_err(Self::rule_error)?;
        rule.pattern = rule.pattern.trim().to_string();
        if state.store.update_rule(&rule).await? {
            Ok(Json(rule.into()))
        } else {
            Err(ApiError::NotFound)
        }
    }

    pub async fn delete_rule(state: AppState, id: i64) -> Result<StatusCode, ApiError> {
        if state.store.delete_rule(id).await? {
            Ok(StatusCode::NO_CONTENT)
        } else {
            Err(ApiError::NotFound)
        }
    }

    pub async fn reorder_rules(
        state: AppState,
        order: RuleOrder,
    ) -> Result<Json<Vec<RuleDto>>, ApiError> {
        if !state.store.reorder_rules(&order.ids).await? {
            return Err(ApiError::BadRequest(
                "ids must list every rule exactly once".into(),
            ));
        }
        Self::list_rules(state).await
    }

    pub async fn apply_rules(state: AppState) -> Result<Json<ApplyReport>, ApiError> {
        Ok(Json(ApplyReport {
            changed: state.store.apply_rules().await?,
        }))
    }

    pub async fn set_category(
        state: AppState,
        id: i64,
        change: CategoryChange,
    ) -> Result<Json<CategoryChanged>, ApiError> {
        let tx = state
            .store
            .get_transaction(id)
            .await?
            .ok_or(ApiError::NotFound)?;
        if change.remember && NameNormalizer::normalize(&tx.transaction.counterparty).is_empty() {
            return Err(ApiError::BadRequest(
                "this transaction has no merchant name to remember".into(),
            ));
        }
        if !state
            .store
            .set_transaction_category(id, change.category)
            .await?
        {
            return Err(ApiError::NotFound);
        }
        let (rule, others_changed) = if change.remember {
            let rule = state
                .store
                .remember_merchant(&tx.transaction.counterparty, change.category)
                .await?;
            (Some(RuleDto::from(rule)), state.store.apply_rules().await?)
        } else {
            (None, 0)
        };
        let transaction = state
            .store
            .get_transaction(id)
            .await?
            .ok_or(ApiError::NotFound)?;
        Ok(Json(CategoryChanged {
            transaction: transaction.into(),
            rule,
            others_changed,
        }))
    }

    pub async fn list_splits(state: AppState) -> Result<Json<Vec<SplitDto>>, ApiError> {
        Ok(Json(
            state
                .store
                .list_splits()
                .await?
                .into_iter()
                .map(|s| SplitDto {
                    transaction_id: s.transaction_id,
                    parts: s.parts.into_iter().map(SplitPartDto::from).collect(),
                })
                .collect(),
        ))
    }

    pub async fn put_split(
        state: AppState,
        id: i64,
        input: SplitInput,
    ) -> Result<Json<SplitDto>, ApiError> {
        let parts: Vec<SplitPart> = input.parts.into_iter().map(SplitPart::from).collect();
        match state.store.set_split(id, &parts).await? {
            financer_store::SplitOutcome::Saved => {}
            financer_store::SplitOutcome::NotFound => return Err(ApiError::NotFound),
            financer_store::SplitOutcome::Invalid(e) => {
                return Err(ApiError::BadRequest(e.to_string()))
            }
        }
        Ok(Json(SplitDto {
            transaction_id: id,
            parts: state
                .store
                .get_split(id)
                .await?
                .into_iter()
                .map(SplitPartDto::from)
                .collect(),
        }))
    }

    pub async fn delete_split(state: AppState, id: i64) -> Result<StatusCode, ApiError> {
        if state.store.clear_split(id).await? {
            Ok(StatusCode::NO_CONTENT)
        } else {
            Err(ApiError::NotFound)
        }
    }

    pub async fn categorize_unknown(state: AppState) -> Result<Json<SuggestionsDto>, ApiError> {
        let unknown = state
            .store
            .unknown_merchants(Suggester::MAX_MERCHANTS)
            .await?;
        let counts: HashMap<String, usize> = unknown
            .iter()
            .map(|m| (Suggester::sendable(&m.name), m.count))
            .filter(|(name, _)| !name.is_empty())
            .collect();
        if counts.is_empty() {
            return Ok(Json(SuggestionsDto {
                suggestions: Vec::new(),
                merchants_sent: 0,
            }));
        }
        let mut merchants: Vec<String> = counts.keys().cloned().collect();
        merchants.sort_by(|a, b| counts[b].cmp(&counts[a]).then_with(|| a.cmp(b)));

        let llm = Grocery::build_llm(&state).await?;
        let answer = llm
            .complete_json(Suggester::SYSTEM, &Suggester::prompt(&merchants))
            .await
            .map_err(|e| match e {
                LlmError::MissingKey(_) => ApiError::Unavailable(e.to_string()),
                other => ApiError::BadGateway(other.to_string().chars().take(300).collect()),
            })?;
        let sent: HashSet<String> = merchants.iter().cloned().collect();
        let parsed = Suggester::parse(&answer, &sent).map_err(|e| {
            ApiError::BadGateway(format!(
                "the model did not return usable categories: {}",
                e.chars().take(200).collect::<String>()
            ))
        })?;
        let mut suggestions: Vec<SuggestionDto> = parsed
            .into_iter()
            .map(|(merchant, category)| SuggestionDto {
                transactions: counts[&merchant],
                merchant,
                category,
            })
            .collect();
        suggestions.sort_by(|a, b| {
            b.transactions
                .cmp(&a.transactions)
                .then_with(|| a.merchant.cmp(&b.merchant))
        });
        Ok(Json(SuggestionsDto {
            suggestions,
            merchants_sent: merchants.len(),
        }))
    }

    pub async fn accept_suggestions(
        state: AppState,
        body: AcceptSuggestions,
    ) -> Result<Json<AcceptReport>, ApiError> {
        let mut checked = Vec::new();
        for s in &body.suggestions {
            if NameNormalizer::normalize(&s.merchant).is_empty() {
                return Err(ApiError::BadRequest(
                    "a merchant name needs at least one letter".into(),
                ));
            }
            if !Suggester::is_allowed(s.category) {
                return Err(ApiError::BadRequest(format!(
                    "{:?} is not a category suggestions can use",
                    s.category
                )));
            }
            checked.push(s);
        }
        for s in &checked {
            state
                .store
                .remember_merchant(&s.merchant, s.category)
                .await?;
        }
        let transactions_changed = if checked.is_empty() {
            0
        } else {
            state.store.apply_rules().await?
        };
        Ok(Json(AcceptReport {
            rules_saved: checked.len(),
            transactions_changed,
        }))
    }
}

/// Your categorization rules in priority order (first match wins, before the built-in rules).
#[utoipa::path(
    get,
    path = "/v1/rules",
    responses((status = 200, body = Vec<RuleDto>)),
    security(("bearer" = []))
)]
pub async fn list_rules(State(state): State<AppState>) -> Result<Json<Vec<RuleDto>>, ApiError> {
    Categorization::list_rules(state).await
}

/// Add a rule at the end of the priority order.
#[utoipa::path(
    post,
    path = "/v1/rules",
    request_body = RuleInput,
    responses(
        (status = 201, body = RuleDto),
        (status = 400, description = "Empty pattern or bad amount range", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn create_rule(
    State(state): State<AppState>,
    Json(input): Json<RuleInput>,
) -> Result<(StatusCode, Json<RuleDto>), ApiError> {
    Categorization::create_rule(state, input).await
}

/// Replace a rule's fields; its place in the order stays.
#[utoipa::path(
    put,
    path = "/v1/rules/{id}",
    params(("id" = i64, Path, description = "Rule id")),
    request_body = RuleInput,
    responses(
        (status = 200, body = RuleDto),
        (status = 400, description = "Empty pattern or bad amount range", body = ErrorBody),
        (status = 404, description = "No such rule", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn update_rule(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<RuleInput>,
) -> Result<Json<RuleDto>, ApiError> {
    Categorization::update_rule(state, id, input).await
}

#[utoipa::path(
    delete,
    path = "/v1/rules/{id}",
    params(("id" = i64, Path, description = "Rule id")),
    responses(
        (status = 204, description = "Deleted"),
        (status = 404, description = "No such rule", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn delete_rule(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    Categorization::delete_rule(state, id).await
}

/// Set the priority order of all rules.
#[utoipa::path(
    post,
    path = "/v1/rules/reorder",
    request_body = RuleOrder,
    responses(
        (status = 200, body = Vec<RuleDto>),
        (status = 400, description = "The ids are not every rule exactly once", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn reorder_rules(
    State(state): State<AppState>,
    Json(order): Json<RuleOrder>,
) -> Result<Json<Vec<RuleDto>>, ApiError> {
    Categorization::reorder_rules(state, order).await
}

/// Run the rules again over existing transactions. Transactions you categorized by hand keep
/// their category. Returns how many changed.
#[utoipa::path(
    post,
    path = "/v1/rules/apply",
    responses((status = 200, body = ApplyReport)),
    security(("bearer" = []))
)]
pub async fn apply_rules(State(state): State<AppState>) -> Result<Json<ApplyReport>, ApiError> {
    Categorization::apply_rules(state).await
}

/// Recategorize one transaction. With `remember`, the merchant gets a rule so its other and
/// future transactions follow.
#[utoipa::path(
    put,
    path = "/v1/transactions/{id}/category",
    params(("id" = i64, Path, description = "Transaction id")),
    request_body = CategoryChange,
    responses(
        (status = 200, body = CategoryChanged),
        (status = 400, description = "Nothing to remember: the transaction has no merchant name", body = ErrorBody),
        (status = 404, description = "No such transaction", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn set_category(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(change): Json<CategoryChange>,
) -> Result<Json<CategoryChanged>, ApiError> {
    Categorization::set_category(state, id, change).await
}

/// All split transactions with their parts.
#[utoipa::path(
    get,
    path = "/v1/transactions/splits",
    responses((status = 200, body = Vec<SplitDto>)),
    security(("bearer" = []))
)]
pub async fn list_splits(State(state): State<AppState>) -> Result<Json<Vec<SplitDto>>, ApiError> {
    Categorization::list_splits(state).await
}

/// Split a transaction into parts with their own category. The parts must add up to the
/// transaction amount exactly. Budget and spending totals then use the parts.
#[utoipa::path(
    put,
    path = "/v1/transactions/{id}/split",
    params(("id" = i64, Path, description = "Transaction id")),
    request_body = SplitInput,
    responses(
        (status = 200, body = SplitDto),
        (status = 400, description = "Fewer than two parts, wrong signs or the parts do not add up", body = ErrorBody),
        (status = 404, description = "No such transaction", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn put_split(
    State(state): State<AppState>,
    Path(id): Path<i64>,
    Json(input): Json<SplitInput>,
) -> Result<Json<SplitDto>, ApiError> {
    Categorization::put_split(state, id, input).await
}

/// Remove the split; the transaction counts as a whole again.
#[utoipa::path(
    delete,
    path = "/v1/transactions/{id}/split",
    params(("id" = i64, Path, description = "Transaction id")),
    responses(
        (status = 204, description = "Split removed"),
        (status = 404, description = "No such transaction, or it is not split", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn delete_split(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<StatusCode, ApiError> {
    Categorization::delete_split(state, id).await
}

/// Ask your Claude or OpenAI model to suggest categories for merchants still left as
/// uncategorized or other. Only distinct merchant names (letters only) and the allowed
/// categories are sent; never amounts, dates, IBANs or purposes. Nothing is changed until you
/// accept suggestions.
#[utoipa::path(
    post,
    path = "/v1/transactions/categorize-unknown",
    responses(
        (status = 200, body = SuggestionsDto),
        (status = 503, description = "No API key configured for the selected provider", body = ErrorBody),
        (status = 502, description = "The provider failed or returned nothing usable", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn categorize_unknown(
    State(state): State<AppState>,
) -> Result<Json<SuggestionsDto>, ApiError> {
    Categorization::categorize_unknown(state).await
}

/// Accept suggestions: one rule per merchant, then the rules are applied to existing
/// transactions.
#[utoipa::path(
    post,
    path = "/v1/transactions/categorize-unknown/accept",
    request_body = AcceptSuggestions,
    responses(
        (status = 200, body = AcceptReport),
        (status = 400, description = "A merchant without letters or a category suggestions cannot use", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn accept_suggestions(
    State(state): State<AppState>,
    Json(body): Json<AcceptSuggestions>,
) -> Result<Json<AcceptReport>, ApiError> {
    Categorization::accept_suggestions(state, body).await
}
