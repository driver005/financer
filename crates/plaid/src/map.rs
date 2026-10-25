//! Plaid transactions to Financer transactions.

use financer_core::{Money, Transaction};
use time::Date;

use crate::types::RawTransaction;

pub(crate) enum Mapped {
    Booked(Transaction),
    /// Not imported: pending, another currency, or an unreadable date.
    Skipped,
}

const DATE_FORMAT: &[time::format_description::BorrowedFormatItem<'static>] =
    time::macros::format_description!("[year]-[month]-[day]");

/// Plaid reports money leaving the account as a positive amount; Financer as a negative one.
pub(crate) fn cents(plaid_amount: f64) -> i64 {
    (-plaid_amount * 100.0).round() as i64
}

pub(crate) fn map_transaction(raw: &RawTransaction) -> Mapped {
    if raw.pending {
        return Mapped::Skipped;
    }
    // Financer counts in euro; another currency would be added up wrongly
    if raw
        .iso_currency_code
        .as_deref()
        .is_some_and(|c| !c.eq_ignore_ascii_case("EUR"))
    {
        return Mapped::Skipped;
    }
    let Ok(booking_date) = Date::parse(&raw.date, DATE_FORMAT) else {
        return Mapped::Skipped;
    };
    let name = raw.name.as_deref().map(str::trim).unwrap_or("");
    let meta = raw.payment_meta.as_ref();
    let counterparty = raw
        .merchant_name
        .as_deref()
        .or(meta.and_then(|m| m.payee.as_deref()))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(name)
        .to_string();
    let mut purpose = name.to_string();
    if let Some(reference) = meta
        .and_then(|m| m.reference_number.as_deref())
        .map(str::trim)
        .filter(|r| !r.is_empty() && !purpose.contains(*r))
    {
        if !purpose.is_empty() {
            purpose.push(' ');
        }
        purpose.push_str(reference);
    }
    Mapped::Booked(Transaction {
        booking_date,
        amount: Money::from_cents(cents(raw.amount)),
        counterparty,
        purpose,
        counterparty_iban: None,
        category: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(json: &str) -> RawTransaction {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn money_leaving_the_account_becomes_negative() {
        assert_eq!(cents(12.94), -1294);
        assert_eq!(cents(-2650.0), 265_000);
        // binary floating point must not shift a cent
        assert_eq!(cents(0.29), -29);
        assert_eq!(cents(1.15), -115);
    }

    #[test]
    fn a_booked_euro_transaction_is_mapped() {
        let t = raw(
            r#"{"account_id":"a","amount":12.94,"iso_currency_code":"EUR","date":"2026-10-14",
                "name":"LIDL SAGT DANKE 1234","merchant_name":"Lidl","pending":false}"#,
        );
        let Mapped::Booked(tx) = map_transaction(&t) else {
            panic!("should be booked")
        };
        assert_eq!(tx.amount.cents(), -1294);
        assert_eq!(tx.counterparty, "Lidl");
        assert_eq!(tx.purpose, "LIDL SAGT DANKE 1234");
        assert_eq!(tx.booking_date.to_string(), "2026-10-14");
    }

    #[test]
    fn the_merchant_falls_back_to_the_payee_and_then_the_name() {
        let t = raw(
            r#"{"account_id":"a","amount":5.0,"date":"2026-10-14","name":"SEPA Zahlung",
                "payment_meta":{"payee":"Stadtwerke","reference_number":"RE-77"}}"#,
        );
        let Mapped::Booked(tx) = map_transaction(&t) else {
            panic!()
        };
        assert_eq!(tx.counterparty, "Stadtwerke");
        assert_eq!(tx.purpose, "SEPA Zahlung RE-77");
        let t = raw(r#"{"account_id":"a","amount":5.0,"date":"2026-10-14","name":"Dauerauftrag"}"#);
        let Mapped::Booked(tx) = map_transaction(&t) else {
            panic!()
        };
        assert_eq!(tx.counterparty, "Dauerauftrag");
    }

    #[test]
    fn pending_other_currency_and_bad_dates_are_skipped() {
        for json in [
            r#"{"account_id":"a","amount":1.0,"date":"2026-10-14","name":"x","pending":true}"#,
            r#"{"account_id":"a","amount":1.0,"date":"2026-10-14","name":"x","iso_currency_code":"USD"}"#,
            r#"{"account_id":"a","amount":1.0,"date":"14.10.2026","name":"x"}"#,
        ] {
            assert!(
                matches!(map_transaction(&raw(json)), Mapped::Skipped),
                "{json}"
            );
        }
    }

    #[test]
    fn the_same_transaction_has_the_same_fingerprint_as_an_import_of_it() {
        // a Sparkasse CSV row and the Plaid row of the same booking must not double up
        let t = raw(
            r#"{"account_id":"a","amount":12.94,"iso_currency_code":"EUR","date":"2026-10-14",
                "name":"Lidl Dienstleistung GmbH","pending":false}"#,
        );
        let Mapped::Booked(from_plaid) = map_transaction(&t) else {
            panic!()
        };
        let csv = Transaction {
            booking_date: from_plaid.booking_date,
            amount: Money::from_cents(-1294),
            counterparty: "Lidl Dienstleistung GmbH".into(),
            purpose: "Lidl Dienstleistung GmbH".into(),
            counterparty_iban: None,
            category: None,
        };
        assert_eq!(from_plaid.fingerprint(), csv.fingerprint());
    }
}
