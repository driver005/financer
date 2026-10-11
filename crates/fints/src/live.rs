//! The real FinTS client, via the `fints-rs` crate (FinTS 3.0 PinTan, decoupled TAN).
//!
//! This can only be checked against a real bank with a registered product id, so what is
//! unit-tested here is the conversion of its results into Financer's types. See docs/FINTS.md
//! for the registration steps and what to expect on a first live run.

use async_trait::async_trait;
use chrono::Datelike;
use financer_core::{Money, Transaction};
use fints::{FinTSError, Flow, Pin, ProductId, TransactionStatus, UserId};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use time::{Date, Month};

use crate::bank::{BankClient, BankData, BankError, PendingSync, SyncParams, TanChallenge};

pub struct FintsBank {
    product_id: String,
}

impl FintsBank {
    /// `product_id` is the id issued by the Deutsche Kreditwirtschaft for this application.
    pub fn new(product_id: &str) -> Self {
        Self {
            product_id: product_id.trim().to_string(),
        }
    }
}

fn map_error(e: FinTSError) -> BankError {
    match e {
        FinTSError::Auth(m) | FinTSError::TanRejected(m) => BankError::Rejected(m),
        FinTSError::Dialog(m) if m.contains("TAN still pending") => BankError::TanPending,
        FinTSError::Dialog(m) => BankError::Rejected(m),
        other => BankError::Connection(other.to_string()),
    }
}

/// `-23.47` -> `-2347` cents. Amounts with more than two decimals are rounded.
pub(crate) fn decimal_to_money(d: Decimal) -> Option<Money> {
    (d * Decimal::from(100))
        .round()
        .to_i64()
        .map(Money::from_cents)
}

pub(crate) fn naive_to_date(d: chrono::NaiveDate) -> Option<Date> {
    Date::from_calendar_date(
        d.year(),
        Month::try_from(d.month() as u8).ok()?,
        d.day() as u8,
    )
    .ok()
}

/// Convert one fints transaction. `None` means skipped: pending, not EUR, or unreadable.
pub(crate) fn convert_transaction(t: &fints::Transaction) -> Option<Transaction> {
    if t.status != TransactionStatus::Booked || !t.currency.as_str().eq_ignore_ascii_case("EUR") {
        return None;
    }
    Some(Transaction {
        booking_date: naive_to_date(t.date)?,
        amount: decimal_to_money(t.amount)?,
        counterparty: t
            .applicant_name
            .clone()
            .unwrap_or_default()
            .trim()
            .to_string(),
        purpose: t
            .purpose
            .clone()
            .or_else(|| t.posting_text.clone())
            .unwrap_or_default()
            .trim()
            .to_string(),
        counterparty_iban: t
            .applicant_iban
            .as_ref()
            .map(|i| i.as_str().to_string())
            .filter(|s| !s.is_empty()),
        category: None,
    })
}

struct LivePending {
    flow: Flow,
    iban: String,
    bic: String,
    days: u32,
}

#[async_trait]
impl PendingSync for LivePending {
    async fn confirm(&mut self) -> Result<BankData, BankError> {
        let result = self
            .flow
            .confirm_and_fetch(&self.iban, &self.bic, self.days)
            .await
            .map_err(map_error)?;
        let mut transactions = Vec::new();
        let mut skipped = 0;
        for t in &result.transactions {
            match convert_transaction(t) {
                Some(tx) => transactions.push(tx),
                None => skipped += 1,
            }
        }
        let balance = result
            .balance
            .as_ref()
            .filter(|b| b.currency.as_str().eq_ignore_ascii_case("EUR"));
        Ok(BankData {
            balance: balance.and_then(|b| decimal_to_money(b.amount)),
            balance_date: balance.and_then(|b| naive_to_date(b.date)),
            transactions,
            skipped,
        })
    }
}

#[async_trait]
impl BankClient for FintsBank {
    async fn start(
        &self,
        params: &SyncParams,
    ) -> Result<(Box<dyn PendingSync>, TanChallenge), BankError> {
        if self.product_id.is_empty() {
            return Err(BankError::NotConfigured);
        }
        let (flow, challenge) = Flow::initiate(
            params.blz.trim(),
            &UserId::new(params.user_id.trim()),
            &Pin::new(params.pin.clone()),
            &ProductId::new(self.product_id.clone()),
            None,
            None,
            None,
        )
        .await
        .map_err(map_error)?;

        // fints-rs polls decoupled TANs (pushTAN); a method that needs a typed TAN cannot be completed.
        if !challenge.decoupled && !challenge.no_tan_required {
            return Err(BankError::UnsupportedTan);
        }
        let pending = LivePending {
            flow,
            iban: params.iban.trim().to_string(),
            bic: params.bic.trim().to_string(),
            days: params.days,
        };
        Ok((
            Box::new(pending),
            TanChallenge {
                text: challenge.challenge.as_str().to_string(),
                no_tan_required: challenge.no_tan_required,
            },
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fints::{Currency, Iban};
    use std::str::FromStr;

    fn tx(amount: &str, currency: &str, status: TransactionStatus) -> fints::Transaction {
        fints::Transaction {
            date: chrono::NaiveDate::from_ymd_opt(2026, 3, 2).unwrap(),
            valuta_date: None,
            amount: Decimal::from_str(amount).unwrap(),
            currency: Currency::new(currency),
            applicant_name: Some("  REWE Markt GmbH ".into()),
            applicant_iban: Some(Iban::new("DE02120300000000202051")),
            applicant_bic: None,
            purpose: Some("Kartenzahlung".into()),
            posting_text: Some("KARTE".into()),
            reference: None,
            raw: serde_json::Value::Null,
            status,
        }
    }

    #[test]
    fn converts_amounts_without_floats() {
        assert_eq!(
            decimal_to_money(Decimal::from_str("-23.47").unwrap()),
            Some(Money::from_cents(-2347))
        );
        assert_eq!(
            decimal_to_money(Decimal::from_str("2500").unwrap()),
            Some(Money::from_cents(250_000))
        );
        assert_eq!(
            decimal_to_money(Decimal::from_str("0.1").unwrap()),
            Some(Money::from_cents(10))
        );
        assert_eq!(
            decimal_to_money(Decimal::from_str("1234567.89").unwrap()),
            Some(Money::from_cents(123_456_789))
        );
    }

    #[test]
    fn converts_a_booked_euro_transaction() {
        let t = convert_transaction(&tx("-23.47", "EUR", TransactionStatus::Booked)).unwrap();
        assert_eq!(t.amount, Money::from_cents(-2347));
        assert_eq!(t.booking_date, time::macros::date!(2026 - 03 - 02));
        assert_eq!(t.counterparty, "REWE Markt GmbH");
        assert_eq!(t.purpose, "Kartenzahlung");
        assert_eq!(
            t.counterparty_iban.as_deref(),
            Some("DE02120300000000202051")
        );
        assert_eq!(t.category, None);
    }

    #[test]
    fn skips_pending_and_foreign_currency() {
        assert!(convert_transaction(&tx("-1.00", "EUR", TransactionStatus::Pending)).is_none());
        assert!(convert_transaction(&tx("-1.00", "USD", TransactionStatus::Booked)).is_none());
    }

    #[test]
    fn falls_back_to_posting_text_for_purpose() {
        let mut t = tx("-1.00", "EUR", TransactionStatus::Booked);
        t.purpose = None;
        assert_eq!(convert_transaction(&t).unwrap().purpose, "KARTE");
    }

    #[test]
    fn maps_errors() {
        assert!(matches!(
            map_error(FinTSError::Auth("bad pin".into())),
            BankError::Rejected(_)
        ));
        assert!(matches!(
            map_error(FinTSError::Dialog(
                "TAN still pending: user has not yet confirmed in banking app".into()
            )),
            BankError::TanPending
        ));
        assert!(matches!(
            map_error(FinTSError::Transport("down".into())),
            BankError::Connection(_)
        ));
    }

    #[tokio::test]
    async fn refuses_to_start_without_a_product_id() {
        let params = SyncParams {
            blz: "1".into(),
            user_id: "u".into(),
            pin: "p".into(),
            iban: "i".into(),
            bic: String::new(),
            days: 1,
        };
        assert!(matches!(
            FintsBank::new("  ").start(&params).await,
            Err(BankError::NotConfigured)
        ));
    }
}
