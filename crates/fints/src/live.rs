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

/// A bank that is not in the built-in registry, or a test server.
#[derive(Clone)]
struct Endpoint {
    bic: String,
    url: String,
}

pub struct FintsBank {
    product_id: String,
    endpoint: Option<Endpoint>,
}

impl FintsBank {
    /// `product_id` is the id issued by the Deutsche Kreditwirtschaft for this application.
    pub fn new(product_id: &str) -> Self {
        Self {
            product_id: product_id.trim().to_string(),
            endpoint: None,
        }
    }

    /// Talk to this FinTS URL instead of looking the bank code up in the built-in registry
    /// (for a bank the registry lacks, or a test server). `bic` is the bank's BIC.
    pub fn with_endpoint(mut self, bic: &str, url: &str) -> Self {
        self.endpoint = Some(Endpoint {
            bic: bic.to_string(),
            url: url.to_string(),
        });
        self
    }
}

/// Windows-1252 maps bytes 0x80..=0x9F to these characters (the rest of 0x80..=0xFF is Latin-1).
const CP1252_HIGH: [(char, u8); 27] = [
    ('€', 0x80),
    ('‚', 0x82),
    ('ƒ', 0x83),
    ('„', 0x84),
    ('…', 0x85),
    ('†', 0x86),
    ('‡', 0x87),
    ('ˆ', 0x88),
    ('‰', 0x89),
    ('Š', 0x8A),
    ('‹', 0x8B),
    ('Œ', 0x8C),
    ('Ž', 0x8E),
    ('‘', 0x91),
    ('’', 0x92),
    ('“', 0x93),
    ('”', 0x94),
    ('•', 0x95),
    ('–', 0x96),
    ('—', 0x97),
    ('˜', 0x98),
    ('™', 0x99),
    ('š', 0x9A),
    ('›', 0x9B),
    ('œ', 0x9C),
    ('ž', 0x9E),
    ('Ÿ', 0x9F),
];

/// Repairs text that `fints-rs` decoded with the wrong charset.
pub(crate) struct TextRepair;

impl TextRepair {
    fn cp1252_byte(c: char) -> Option<u8> {
        match u32::from(c) {
            0x80..=0x9F => None, // C1 controls are not produced by cp1252 decoding
            n if n < 0x100 => Some(n as u8),
            _ => CP1252_HIGH.iter().find(|(ch, _)| *ch == c).map(|(_, b)| *b),
        }
    }

    /// Some banks (and the mock server) send UTF-8 that `fints-rs` decodes as Windows-1252, giving
    /// "ungÃ¼ltig" for "ungültig". Undo that when, and only when, the result is valid UTF-8.
    pub(crate) fn repair_text(s: &str) -> String {
        if !s.contains('Ã') && !s.contains('Â') {
            return s.to_string();
        }
        let bytes: Option<Vec<u8>> = s.chars().map(Self::cp1252_byte).collect();
        bytes
            .and_then(|b| String::from_utf8(b).ok())
            .unwrap_or_else(|| s.to_string())
    }
}

/// Codes banks use for a wrong login or PIN. `fints-rs` only knows 9340; real banks commonly
/// answer 9931 ("Anmeldename oder PIN ist falsch"), and 9910 is what the mock server sends.
const WRONG_PIN_CODES: [&str; 4] = ["9340", "9910", "9930", "9931"];
/// Codes for a locked PIN or access.
const LOCKED_CODES: [&str; 2] = ["9942", "9943"];

/// Maps `fints-rs` errors onto Financer's [`BankError`].
pub(crate) struct ErrorMapper;

impl ErrorMapper {
    fn classify_bank_error(code: Option<&str>, message: &str) -> BankError {
        let text = TextRepair::repair_text(message);
        let lower = text.to_lowercase();
        let wrong_pin = code.is_some_and(|c| WRONG_PIN_CODES.contains(&c))
            || (lower.contains("pin")
                && ["ungültig", "falsch", "fehlerhaft", "invalid", "wrong"]
                    .iter()
                    .any(|w| lower.contains(w)));
        let locked = code.is_some_and(|c| LOCKED_CODES.contains(&c))
            || lower.contains("gesperrt")
            || lower.contains("locked");
        if locked {
            BankError::Locked
        } else if wrong_pin {
            BankError::WrongPin
        } else {
            BankError::Rejected(text)
        }
    }

    fn map_error(e: FinTSError) -> BankError {
        match e {
            FinTSError::PinWrong => BankError::WrongPin,
            FinTSError::AccountLocked => BankError::Locked,
            FinTSError::TanTimeout => {
                BankError::Rejected("the approval in the banking app did not arrive in time".into())
            }
            FinTSError::Auth(m) | FinTSError::TanRejected(m) => Self::classify_bank_error(None, &m),
            FinTSError::BankError { kind, message } => {
                let code = match &kind {
                    fints::ResponseCodeKind::OtherError(c) => Some(c.as_str()),
                    _ => None,
                };
                Self::classify_bank_error(code, &message)
            }
            FinTSError::Dialog(m) if m.contains("TAN still pending") => BankError::TanPending,
            FinTSError::Dialog(m) => Self::classify_bank_error(None, &m),
            other => BankError::Connection(other.to_string()),
        }
    }
}

/// Converts `fints-rs` values into Financer's types.
pub(crate) struct FintsConverter;

impl FintsConverter {
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
        if t.status != TransactionStatus::Booked || !t.currency.as_str().eq_ignore_ascii_case("EUR")
        {
            return None;
        }
        Some(Transaction {
            booking_date: Self::naive_to_date(t.date)?,
            amount: Self::decimal_to_money(t.amount)?,
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
            .map_err(ErrorMapper::map_error)?;
        let mut transactions = Vec::new();
        let mut skipped = 0;
        for t in &result.transactions {
            match FintsConverter::convert_transaction(t) {
                Some(tx) => transactions.push(tx),
                None => skipped += 1,
            }
        }
        let balance = result
            .balance
            .as_ref()
            .filter(|b| b.currency.as_str().eq_ignore_ascii_case("EUR"));
        Ok(BankData {
            balance: balance.and_then(|b| FintsConverter::decimal_to_money(b.amount)),
            balance_date: balance.and_then(|b| FintsConverter::naive_to_date(b.date)),
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
        let user = UserId::new(params.user_id.trim());
        let pin = Pin::new(params.pin.clone());
        let product = ProductId::new(self.product_id.clone());
        let (flow, challenge) = match &self.endpoint {
            Some(e) => {
                let config = fints::BankConfig::new(
                    "custom",
                    params.blz.trim(),
                    e.bic.as_str(),
                    e.url.as_str(),
                );
                Flow::initiate_with_bank(
                    fints::bank_ops_with_config(config),
                    &user,
                    &pin,
                    &product,
                    None,
                    None,
                    None,
                )
                .await
            }
            None => {
                Flow::initiate(params.blz.trim(), &user, &pin, &product, None, None, None).await
            }
        }
        .map_err(ErrorMapper::map_error)?;

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

    /// Builds fints transactions for the conversion tests.
    struct Fixtures;

    impl Fixtures {
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
    }

    #[test]
    fn converts_amounts_without_floats() {
        assert_eq!(
            FintsConverter::decimal_to_money(Decimal::from_str("-23.47").unwrap()),
            Some(Money::from_cents(-2347))
        );
        assert_eq!(
            FintsConverter::decimal_to_money(Decimal::from_str("2500").unwrap()),
            Some(Money::from_cents(250_000))
        );
        assert_eq!(
            FintsConverter::decimal_to_money(Decimal::from_str("0.1").unwrap()),
            Some(Money::from_cents(10))
        );
        assert_eq!(
            FintsConverter::decimal_to_money(Decimal::from_str("1234567.89").unwrap()),
            Some(Money::from_cents(123_456_789))
        );
    }

    #[test]
    fn converts_a_booked_euro_transaction() {
        let t = FintsConverter::convert_transaction(&Fixtures::tx(
            "-23.47",
            "EUR",
            TransactionStatus::Booked,
        ))
        .unwrap();
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
        assert!(FintsConverter::convert_transaction(&Fixtures::tx(
            "-1.00",
            "EUR",
            TransactionStatus::Pending
        ))
        .is_none());
        assert!(FintsConverter::convert_transaction(&Fixtures::tx(
            "-1.00",
            "USD",
            TransactionStatus::Booked
        ))
        .is_none());
    }

    #[test]
    fn falls_back_to_posting_text_for_purpose() {
        let mut t = Fixtures::tx("-1.00", "EUR", TransactionStatus::Booked);
        t.purpose = None;
        assert_eq!(
            FintsConverter::convert_transaction(&t).unwrap().purpose,
            "KARTE"
        );
    }

    #[test]
    fn repairs_latin1_decoded_utf8_only_when_it_round_trips() {
        assert_eq!(TextRepair::repair_text("Pin ungÃ¼ltig"), "Pin ungültig");
        assert_eq!(TextRepair::repair_text("StraÃŸe"), "Straße");
        assert_eq!(TextRepair::repair_text("Pin ungültig"), "Pin ungültig"); // already fine
        assert_eq!(TextRepair::repair_text("Ärger"), "Ärger"); // a real capital Ä is not damage
        assert_eq!(TextRepair::repair_text("Ã"), "Ã"); // not valid UTF-8 after the round trip: leave alone
        assert_eq!(TextRepair::repair_text("plain"), "plain");
    }

    #[test]
    fn recognises_wrong_pin_and_locked_by_code_or_text() {
        let kind = |c: &str| fints::ResponseCodeKind::OtherError(c.to_string());
        let err = |c: &str, m: &str| {
            ErrorMapper::map_error(FinTSError::BankError {
                kind: kind(c),
                message: m.into(),
            })
        };
        assert!(matches!(
            err("9931", "Anmeldename oder PIN ist falsch"),
            BankError::WrongPin
        ));
        assert!(matches!(err("9910", "Pin ungÃ¼ltig"), BankError::WrongPin));
        assert!(matches!(
            err("9999", "Die PIN ist ungültig"),
            BankError::WrongPin
        )); // by text alone
        assert!(matches!(err("9942", "PIN gesperrt"), BankError::Locked));
        assert!(matches!(err("9999", "Zugang gesperrt"), BankError::Locked));
        match err("9050", "Teilweise fehlerhaft") {
            BankError::Rejected(m) => assert_eq!(m, "Teilweise fehlerhaft"),
            other => panic!("{other:?}"),
        }
        // a locked message that also mentions the PIN is a lock, not a wrong PIN
        assert!(matches!(
            err("9999", "PIN ungültig, Zugang gesperrt"),
            BankError::Locked
        ));
    }

    #[test]
    fn maps_errors() {
        assert!(matches!(
            ErrorMapper::map_error(FinTSError::PinWrong),
            BankError::WrongPin
        ));
        assert!(matches!(
            ErrorMapper::map_error(FinTSError::AccountLocked),
            BankError::Locked
        ));
        assert!(matches!(
            ErrorMapper::map_error(FinTSError::TanTimeout),
            BankError::Rejected(_)
        ));
        assert!(matches!(
            ErrorMapper::map_error(FinTSError::Auth("bad pin".into())),
            BankError::Rejected(_)
        ));
        assert!(matches!(
            ErrorMapper::map_error(FinTSError::Dialog(
                "TAN still pending: user has not yet confirmed in banking app".into()
            )),
            BankError::TanPending
        ));
        assert!(matches!(
            ErrorMapper::map_error(FinTSError::Transport("down".into())),
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
