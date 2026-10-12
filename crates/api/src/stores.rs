//! What is spent at each supermarket chain, from the booked bank transactions.
//!
//! Periods are the payday-based budget periods (see `budget_period.rs`). A booking belongs to a
//! chain through `financer_core::StoreMatcher` (built-in table plus the `[[stores]]` aliases of the
//! server configuration); groceries no chain matched are reported as `other`.

use axum::extract::{Path, Query, State};
use axum::Json;
use financer_core::{
    Bucket, BudgetPeriod, StoreReport, StoreRow, StoreSpending, Transaction, OTHER_ID,
};
use serde::{Deserialize, Serialize};
use time::{Date, Duration, OffsetDateTime};
use utoipa::ToSchema;

use crate::budget_period::BudgetPeriods;
use crate::dto::{ErrorBody, TransactionDto};
use crate::routes::ApiError;
use crate::AppState;

/// Default and largest `n` for `period=last_n`.
const DEFAULT_PERIODS: u32 = 3;
const MAX_PERIODS: u32 = 24;

/// Which budget period(s) to look at.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StoresPeriod {
    /// The period that contains the date (default: today).
    #[default]
    Current,
    /// The period right before it.
    Previous,
    /// The running period and the `n - 1` before it (`n` defaults to 3).
    LastN,
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct StoresQuery {
    /// `current` (default), `previous` or `last_n`.
    period: Option<StoresPeriod>,
    /// With `last_n`: how many budget periods, 1 to 24 (default 3), the running one included.
    n: Option<u32>,
    /// The day to treat as today, ISO format. Defaults to today (UTC); the app sends its local date.
    #[param(value_type = Option<String>, format = Date, example = "2026-10-11")]
    date: Option<Date>,
}

/// One chain over the asked range, compared with the range before it.
#[derive(Debug, Serialize, ToSchema)]
pub struct StoreSpendDto {
    /// Stable id for `/v1/spending/stores/{chain}/transactions`; `other` for unmatched groceries.
    pub chain: String,
    pub name: String,
    pub total_cents: i64,
    /// Number of purchases (each booking is one visit).
    pub visits: u32,
    /// Total divided by visits, rounded to the cent; 0 without visits.
    pub average_basket_cents: i64,
    /// Share of everything spent in stores, in tenths of a percent (123 = 12.3 %).
    pub share_permille: u32,
    #[schema(value_type = Option<String>, format = Date)]
    pub last_visit: Option<Date>,
    /// Spent in the comparison range (see `compare_start` / `compare_end`).
    pub previous_total_cents: i64,
    pub previous_visits: u32,
    /// `total_cents - previous_total_cents`.
    pub change_cents: i64,
    /// Change relative to the comparison range in tenths of a percent (-333 = -33.3 %); absent
    /// when nothing was spent there.
    pub change_permille: Option<i64>,
}

impl From<StoreRow> for StoreSpendDto {
    fn from(r: StoreRow) -> Self {
        StoreSpendDto {
            chain: r.id,
            name: r.name,
            total_cents: r.total.cents(),
            visits: r.visits,
            average_basket_cents: r.average_basket.cents(),
            share_permille: r.share_permille,
            last_visit: r.last_visit,
            previous_total_cents: r.previous_total.cents(),
            previous_visits: r.previous_visits,
            change_cents: r.change.cents(),
            change_permille: r.change_permille,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct StoresDto {
    /// First day of the range, inclusive.
    #[schema(value_type = String, format = Date)]
    pub start: Date,
    /// Last day of the range, inclusive.
    #[schema(value_type = String, format = Date)]
    pub end: Date,
    /// How many budget periods the range covers.
    pub periods: u32,
    /// The range the numbers are compared with: the same number of periods right before `start`.
    #[schema(value_type = String, format = Date)]
    pub compare_start: Date,
    #[schema(value_type = String, format = Date)]
    pub compare_end: Date,
    /// True while the range is still running: the comparison then covers only as many days as
    /// have passed, so that half a month is not compared with a whole one.
    pub compare_is_partial: bool,
    /// Everything spent in stores (chains plus unmatched groceries).
    pub total_cents: i64,
    pub previous_total_cents: i64,
    /// Chains with purchases in the range, largest first.
    pub chains: Vec<StoreSpendDto>,
    /// Grocery bookings that no chain matched (`chain` is `other`); always present.
    pub other: StoreSpendDto,
}

/// The dates behind one request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoreRanges {
    pub start: Date,
    pub end: Date,
    pub periods: u32,
    pub compare_start: Date,
    pub compare_end: Date,
    pub partial: bool,
}

impl StoreRanges {
    /// The range for `choice` around `today`, and the one to compare it with.
    pub fn resolve(payday: u8, choice: StoresPeriod, n: u32, today: Date) -> StoreRanges {
        let current = BudgetPeriod::containing(today, payday);
        let (last, count) = match choice {
            StoresPeriod::Current => (current, 1),
            StoresPeriod::Previous => (current.previous(payday), 1),
            StoresPeriod::LastN => (current, n),
        };
        let mut first = last;
        for _ in 1..count {
            first = first.previous(payday);
        }
        let (start, end) = (first.start, last.end);

        let compare_full_end = start - Duration::days(1);
        let mut compare_first = BudgetPeriod::containing(compare_full_end, payday);
        for _ in 1..count {
            compare_first = compare_first.previous(payday);
        }
        let compare_start = compare_first.start;

        let partial = today < end;
        let compare_end = if partial {
            let elapsed = (today - start).whole_days().max(0);
            (compare_start + Duration::days(elapsed)).min(compare_full_end)
        } else {
            compare_full_end
        };
        StoreRanges {
            start,
            end,
            periods: count,
            compare_start,
            compare_end,
            partial,
        }
    }
}

pub struct Stores;

impl Stores {
    fn today() -> Date {
        OffsetDateTime::now_utc().date()
    }

    async fn ranges(state: &AppState, q: &StoresQuery) -> Result<StoreRanges, ApiError> {
        let n = q.n.unwrap_or(DEFAULT_PERIODS);
        if !(1..=MAX_PERIODS).contains(&n) {
            return Err(ApiError::BadRequest(format!(
                "n must be between 1 and {MAX_PERIODS}"
            )));
        }
        let payday = BudgetPeriods::payday(state).await?;
        Ok(StoreRanges::resolve(
            payday,
            q.period.unwrap_or_default(),
            n,
            q.date.unwrap_or_else(Self::today),
        ))
    }

    pub async fn spending(state: AppState, q: StoresQuery) -> Result<Json<StoresDto>, ApiError> {
        let ranges = Self::ranges(&state, &q).await?;
        let txs: Vec<Transaction> = state
            .store
            .list_transactions()
            .await?
            .into_iter()
            .map(|s| s.transaction)
            .collect();
        let matcher = &*state.store_matcher;
        let current = StoreSpending::totals(matcher, &txs, ranges.start, ranges.end);
        let previous =
            StoreSpending::totals(matcher, &txs, ranges.compare_start, ranges.compare_end);
        let StoreReport {
            chains,
            other,
            total,
            previous_total,
        } = StoreSpending::report(matcher, &current, &previous);
        Ok(Json(StoresDto {
            start: ranges.start,
            end: ranges.end,
            periods: ranges.periods,
            compare_start: ranges.compare_start,
            compare_end: ranges.compare_end,
            compare_is_partial: ranges.partial,
            total_cents: total.cents(),
            previous_total_cents: previous_total.cents(),
            chains: chains.into_iter().map(Into::into).collect(),
            other: other.into(),
        }))
    }

    pub async fn transactions(
        state: AppState,
        chain: String,
        q: StoresQuery,
    ) -> Result<Json<Vec<TransactionDto>>, ApiError> {
        if chain != OTHER_ID && state.store_matcher.chain(&chain).is_none() {
            return Err(ApiError::NotFound);
        }
        let ranges = Self::ranges(&state, &q).await?;
        let matcher = &*state.store_matcher;
        Ok(Json(
            state
                .store
                .list_transactions()
                .await?
                .into_iter()
                .filter(|s| {
                    let d = s.transaction.booking_date;
                    d >= ranges.start
                        && d <= ranges.end
                        && StoreSpending::bucket(matcher, &s.transaction)
                            .as_ref()
                            .map(Bucket::id)
                            == Some(chain.as_str())
                })
                .map(TransactionDto::from)
                .collect(),
        ))
    }
}

/// What is spent at each supermarket chain in a budget period, ranked, with the share of all store
/// spending, number of visits, average basket, last visit and the change against the range before.
/// Groceries that no chain matched are in `other`.
#[utoipa::path(
    get,
    path = "/v1/spending/stores",
    params(StoresQuery),
    responses(
        (status = 200, body = StoresDto),
        (status = 400, description = "n out of range", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn store_spending(
    State(state): State<AppState>,
    Query(q): Query<StoresQuery>,
) -> Result<Json<StoresDto>, ApiError> {
    Stores::spending(state, q).await
}

/// The purchases behind one chain's total (`other` for unmatched groceries), newest first.
#[utoipa::path(
    get,
    path = "/v1/spending/stores/{chain}/transactions",
    params(("chain" = String, Path, description = "chain id from /v1/spending/stores, or other"), StoresQuery),
    responses(
        (status = 200, body = Vec<TransactionDto>),
        (status = 404, description = "Unknown chain", body = ErrorBody),
        (status = 400, description = "n out of range", body = ErrorBody),
    ),
    security(("bearer" = []))
)]
pub async fn store_transactions(
    State(state): State<AppState>,
    Path(chain): Path<String>,
    Query(q): Query<StoresQuery>,
) -> Result<Json<Vec<TransactionDto>>, ApiError> {
    Stores::transactions(state, chain, q).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn current_period_compares_the_same_elapsed_days() {
        // payday 1, 11 October: 11 days of October against the first 11 days of September
        let r = StoreRanges::resolve(1, StoresPeriod::Current, 1, date!(2026 - 10 - 11));
        assert_eq!(
            (r.start, r.end),
            (date!(2026 - 10 - 01), date!(2026 - 10 - 31))
        );
        assert!(r.partial);
        assert_eq!(
            (r.compare_start, r.compare_end),
            (date!(2026 - 09 - 01), date!(2026 - 09 - 11))
        );
    }

    #[test]
    fn a_finished_period_is_compared_with_the_whole_one_before() {
        let r = StoreRanges::resolve(1, StoresPeriod::Previous, 1, date!(2026 - 10 - 11));
        assert_eq!(
            (r.start, r.end),
            (date!(2026 - 09 - 01), date!(2026 - 09 - 30))
        );
        assert!(!r.partial);
        assert_eq!(
            (r.compare_start, r.compare_end),
            (date!(2026 - 08 - 01), date!(2026 - 08 - 31))
        );
        // the last day of the running period is not partial either
        let r = StoreRanges::resolve(1, StoresPeriod::Current, 1, date!(2026 - 10 - 31));
        assert!(!r.partial);
        assert_eq!(r.compare_end, date!(2026 - 09 - 30));
    }

    #[test]
    fn payday_periods_and_a_shorter_previous_period() {
        // payday 25: period 25 Sep - 24 Oct; the one before is 25 Aug - 24 Sep (31 days)
        let r = StoreRanges::resolve(25, StoresPeriod::Current, 1, date!(2026 - 10 - 11));
        assert_eq!(
            (r.start, r.end),
            (date!(2026 - 09 - 25), date!(2026 - 10 - 24))
        );
        assert_eq!(
            (r.compare_start, r.compare_end),
            (date!(2026 - 08 - 25), date!(2026 - 09 - 10))
        );
        // March compared with February (28 days): the comparison cannot run past its end
        let r = StoreRanges::resolve(1, StoresPeriod::Current, 1, date!(2026 - 03 - 30));
        assert_eq!(r.compare_end, date!(2026 - 02 - 28));
    }

    #[test]
    fn last_n_covers_the_running_period_and_the_ones_before() {
        let r = StoreRanges::resolve(1, StoresPeriod::LastN, 3, date!(2026 - 10 - 11));
        assert_eq!(
            (r.start, r.end),
            (date!(2026 - 08 - 01), date!(2026 - 10 - 31))
        );
        assert_eq!(r.periods, 3);
        assert!(r.partial);
        // 71 days have passed since 1 Aug; compared with the same span after 1 May
        assert_eq!(r.compare_start, date!(2026 - 05 - 01));
        assert_eq!(r.compare_end, date!(2026 - 07 - 11));
        let one = StoreRanges::resolve(1, StoresPeriod::LastN, 1, date!(2026 - 10 - 11));
        let cur = StoreRanges::resolve(1, StoresPeriod::Current, 1, date!(2026 - 10 - 11));
        assert_eq!(one, cur);
    }

    #[test]
    fn year_end() {
        let r = StoreRanges::resolve(1, StoresPeriod::Current, 1, date!(2027 - 01 - 05));
        assert_eq!(
            (r.start, r.end),
            (date!(2027 - 01 - 01), date!(2027 - 01 - 31))
        );
        assert_eq!(
            (r.compare_start, r.compare_end),
            (date!(2026 - 12 - 01), date!(2026 - 12 - 05))
        );
    }
}
