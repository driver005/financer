//! Live bank access, kept behind a small trait so the API's TAN handling can be tested with a
//! mock and the real FinTS client stays swappable.
//!
//! A sync has two steps because of strong customer authentication: [`BankClient::start`] logs
//! in and returns a challenge ("confirm in your Sparkasse app"); the returned [`PendingSync`]
//! is polled with [`PendingSync::confirm`] until you have approved, and then yields the data.

use std::collections::VecDeque;
use std::fmt;
use std::sync::Mutex;

use async_trait::async_trait;
use financer_core::{Money, Transaction};
use time::Date;

/// What to sync. The PIN is a secret: it is never stored, logged or included in `Debug`.
#[derive(Clone)]
pub struct SyncParams {
    /// Bank code (BLZ), e.g. `37050198`.
    pub blz: String,
    pub user_id: String,
    pub pin: String,
    pub iban: String,
    /// Leave empty to use the bank's own BIC.
    pub bic: String,
    /// How many days back to fetch (the bank may limit this, often to 90 days without a TAN).
    pub days: u32,
    /// The bank's FinTS address, for a bank that is not in the built-in list (then `bic` is
    /// needed too). `None` looks the bank code up.
    pub fints_url: Option<String>,
}

impl fmt::Debug for SyncParams {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SyncParams")
            .field("blz", &self.blz)
            .field("user_id", &"<redacted>")
            .field("pin", &"<redacted>")
            .field("iban", &"<redacted>")
            .field("days", &self.days)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TanChallenge {
    /// Text from the bank, shown to the user.
    pub text: String,
    /// True when the bank needs no approval for this sync (SCA exemption).
    pub no_tan_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BankData {
    pub balance: Option<Money>,
    pub balance_date: Option<Date>,
    /// Booked transactions only (pending ones would change when they book).
    pub transactions: Vec<Transaction>,
    /// Transactions skipped, e.g. because they are not in EUR.
    pub skipped: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum BankError {
    #[error("no FinTS product id is configured on the server (see docs/FINTS.md)")]
    NotConfigured,
    #[error("the bank requires a TAN method this app does not support; only pushTAN (approval in the banking app) works")]
    UnsupportedTan,
    #[error("still waiting for you to approve in the banking app")]
    TanPending,
    #[error("the bank refused the PIN or login. Repeated wrong PINs can lock your online banking: check your credentials (for example by logging in on the Sparkasse website) before trying again")]
    WrongPin,
    #[error("your online banking access is locked; unlock it with your bank first")]
    Locked,
    #[error("the bank rejected the request: {0}")]
    Rejected(String),
    #[error("bank connection failed: {0}")]
    Connection(String),
}

#[async_trait]
pub trait PendingSync: Send {
    /// Check whether the TAN was approved and, if so, fetch the data. Returns
    /// [`BankError::TanPending`] while waiting; the same value can then be polled again.
    async fn confirm(&mut self) -> Result<BankData, BankError>;
}

#[async_trait]
pub trait BankClient: Send + Sync {
    async fn start(
        &self,
        params: &SyncParams,
    ) -> Result<(Box<dyn PendingSync>, TanChallenge), BankError>;
}

/// Scripted bank for tests: answers `confirm` calls in order.
pub struct MockBank {
    challenge: TanChallenge,
    script: Mutex<VecDeque<Result<BankData, BankError>>>,
    start_error: Mutex<Option<fn() -> BankError>>,
    pub started: Mutex<Vec<String>>,
}

impl MockBank {
    /// `script` is what successive `confirm` calls return; `Err(TanPending)` entries model
    /// "not approved yet".
    pub fn new(challenge: &str, script: Vec<Result<BankData, BankError>>) -> Self {
        Self {
            challenge: TanChallenge {
                text: challenge.into(),
                no_tan_required: false,
            },
            script: Mutex::new(script.into()),
            start_error: Mutex::new(None),
            started: Mutex::new(Vec::new()),
        }
    }

    /// A bank that refuses every login with the error `make` builds (e.g. a wrong PIN).
    pub fn failing_start(make: fn() -> BankError) -> Self {
        let bank = Self::new("", vec![]);
        *bank.start_error.lock().expect("mock lock") = Some(make);
        bank
    }
}

struct MockPending(Mutex<VecDeque<Result<BankData, BankError>>>);

#[async_trait]
impl PendingSync for MockPending {
    async fn confirm(&mut self) -> Result<BankData, BankError> {
        self.0
            .lock()
            .expect("mock lock")
            .pop_front()
            .unwrap_or(Err(BankError::Connection("script exhausted".into())))
    }
}

#[async_trait]
impl BankClient for MockBank {
    async fn start(
        &self,
        params: &SyncParams,
    ) -> Result<(Box<dyn PendingSync>, TanChallenge), BankError> {
        self.started
            .lock()
            .expect("mock lock")
            .push(params.blz.clone());
        if let Some(make) = *self.start_error.lock().expect("mock lock") {
            return Err(make());
        }
        let script = std::mem::take(&mut *self.script.lock().expect("mock lock"));
        Ok((
            Box::new(MockPending(Mutex::new(script))),
            self.challenge.clone(),
        ))
    }
}

/// Used when no FinTS product id is configured: every attempt explains what is missing.
pub struct UnconfiguredBank;

#[async_trait]
impl BankClient for UnconfiguredBank {
    async fn start(
        &self,
        _params: &SyncParams,
    ) -> Result<(Box<dyn PendingSync>, TanChallenge), BankError> {
        Err(BankError::NotConfigured)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_never_shows_secrets() {
        let p = SyncParams {
            blz: "37050198".into(),
            user_id: "mein-login".into(),
            pin: "12345".into(),
            iban: "DE89370400440532013000".into(),
            bic: String::new(),
            days: 30,
            fints_url: None,
        };
        let shown = format!("{p:?}");
        for secret in ["mein-login", "12345", "DE89370400440532013000"] {
            assert!(!shown.contains(secret), "{shown}");
        }
        assert!(shown.contains("37050198"));
    }

    #[tokio::test]
    async fn mock_models_a_pending_tan() {
        let data = BankData {
            balance: Some(Money::from_cents(1234)),
            balance_date: None,
            transactions: vec![],
            skipped: 0,
        };
        let bank = MockBank::new(
            "Bitte bestätigen",
            vec![Err(BankError::TanPending), Ok(data.clone())],
        );
        let params = SyncParams {
            blz: "1".into(),
            user_id: "u".into(),
            pin: "p".into(),
            iban: "i".into(),
            bic: String::new(),
            days: 1,
            fints_url: None,
        };
        let (mut pending, challenge) = bank.start(&params).await.unwrap();
        assert_eq!(challenge.text, "Bitte bestätigen");
        assert!(matches!(
            pending.confirm().await,
            Err(BankError::TanPending)
        ));
        assert_eq!(pending.confirm().await.unwrap(), data);
    }
}
