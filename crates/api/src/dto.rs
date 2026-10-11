//! Wire types. Amounts are integer cents; dates are ISO-8601 (`2026-03-02`).

use financer_core::{Cadence, Category, EnvelopeStatus, Money, RecurringPayment, Transaction};
use financer_store::StoredTransaction;
use serde::{Deserialize, Serialize};
use time::Date;
use utoipa::ToSchema;

#[derive(Debug, Serialize, ToSchema)]
pub struct TransactionDto {
    pub id: i64,
    #[schema(value_type = String, format = Date, example = "2026-03-02")]
    pub booking_date: Date,
    /// Negative for money leaving the account.
    #[schema(value_type = i64, example = -2347)]
    pub amount_cents: Money,
    pub counterparty: String,
    pub purpose: String,
    pub counterparty_iban: Option<String>,
    #[schema(value_type = Option<String>, example = "groceries")]
    pub category: Option<Category>,
}

impl From<StoredTransaction> for TransactionDto {
    fn from(s: StoredTransaction) -> Self {
        let Transaction {
            booking_date,
            amount,
            counterparty,
            purpose,
            counterparty_iban,
            category,
        } = s.transaction;
        TransactionDto {
            id: s.id,
            booking_date,
            amount_cents: amount,
            counterparty,
            purpose,
            counterparty_iban,
            category,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ImportReport {
    /// Rows stored for the first time.
    pub imported: usize,
    /// Rows already stored (same date, amount, counterparty and purpose).
    pub duplicates: usize,
    /// Rows that could not be read, with the reason.
    pub skipped: Vec<SkippedRowDto>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SkippedRowDto {
    pub line: u64,
    pub reason: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RecurringDto {
    pub counterparty: String,
    #[schema(value_type = i64)]
    pub amount_cents: Money,
    #[schema(value_type = String, example = "monthly")]
    pub cadence: Cadence,
    #[schema(value_type = String, format = Date)]
    pub last_date: Date,
    #[schema(value_type = String, format = Date)]
    pub next_expected: Date,
}

impl From<RecurringPayment> for RecurringDto {
    fn from(r: RecurringPayment) -> Self {
        RecurringDto {
            counterparty: r.counterparty,
            amount_cents: r.amount,
            cadence: r.cadence,
            last_date: r.last_date,
            next_expected: r.next_expected,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EnvelopeDto {
    #[schema(value_type = String, example = "groceries")]
    pub category: Category,
    #[schema(value_type = i64, example = 40000)]
    pub limit_cents: Money,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EnvelopeStatusDto {
    #[schema(value_type = String, example = "groceries")]
    pub category: Category,
    #[schema(value_type = i64)]
    pub limit_cents: Money,
    #[schema(value_type = i64)]
    pub spent_cents: Money,
    /// `limit - spent`; negative when overspent.
    #[schema(value_type = i64)]
    pub remaining_cents: Money,
}

impl From<EnvelopeStatus> for EnvelopeStatusDto {
    fn from(s: EnvelopeStatus) -> Self {
        EnvelopeStatusDto {
            category: s.category,
            limit_cents: s.limit,
            spent_cents: s.spent,
            remaining_cents: s.remaining,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DisposableDto {
    #[schema(value_type = i64)]
    pub monthly_income_cents: Money,
    #[schema(value_type = i64)]
    pub monthly_fixed_costs_cents: Money,
    #[schema(value_type = i64)]
    pub disposable_cents: Money,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    pub error: String,
}
