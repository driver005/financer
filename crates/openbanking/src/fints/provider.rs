//! FinTS behind the unified [`Provider`] trait: log in with the PIN (`begin`), wait for the
//! approval in the banking app (`poll`), get the data. Nothing is kept between syncs.
//!
//! Two wrong PINs in a row pause new syncs: banks typically lock online banking after about
//! three, and a locked account is far worse than a short wait.

use std::collections::HashMap;
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use tokio::sync::Mutex;

use super::bank::{BankClient, BankData, BankError, PendingSync, SyncParams};
use crate::types::{BeginRequest, Fetched, Poll, ProviderKind, Step};
use crate::{OpenError, Provider};
use std::sync::Arc;

const PIN_STRIKES: u32 = 2;
const MAX_DAYS: u32 = 365;
/// A login that nobody confirmed is forgotten after this long.
const STALE: Duration = Duration::from_secs(60 * 60);

/// How long syncing pauses after repeated wrong PINs.
pub const DEFAULT_PIN_PAUSE: Duration = Duration::from_secs(15 * 60);

#[derive(Default)]
struct PinGuard {
    failures: u32,
    blocked_until: Option<Instant>,
}

impl PinGuard {
    fn succeeded(&mut self) {
        self.failures = 0;
    }

    /// A login failed; two wrong PINs in a row, or one lock, start a pause.
    fn failed(&mut self, locked: bool, pause: Duration) {
        self.failures += 1;
        if self.failures >= PIN_STRIKES || locked {
            self.blocked_until = Some(Instant::now() + pause);
        }
    }

    /// Minutes left in a pause, if one is active.
    fn blocked_minutes(&mut self) -> Option<u64> {
        let until = self.blocked_until?;
        match until.checked_duration_since(Instant::now()) {
            Some(left) => Some(left.as_secs() / 60 + 1),
            None => {
                self.blocked_until = None;
                self.failures = 0;
                None
            }
        }
    }
}

struct Waiting {
    started: Instant,
    pending: Box<dyn PendingSync>,
}

pub struct FintsProvider {
    bank: Arc<dyn BankClient>,
    guard: Mutex<PinGuard>,
    pause: StdMutex<Duration>,
    waiting: Mutex<HashMap<String, Waiting>>,
}

impl FintsProvider {
    pub fn new(bank: Arc<dyn BankClient>) -> Self {
        Self {
            bank,
            guard: Mutex::new(PinGuard::default()),
            pause: StdMutex::new(DEFAULT_PIN_PAUSE),
            waiting: Mutex::new(HashMap::new()),
        }
    }

    /// How long syncing pauses after repeated wrong PINs (tests shorten it).
    pub fn set_pin_pause(&self, pause: Duration) {
        *self.pause.lock().expect("pause lock") = pause;
    }

    fn pause(&self) -> Duration {
        *self.pause.lock().expect("pause lock")
    }

    /// A bank error as the unified one.
    pub fn error(e: BankError) -> OpenError {
        let text = e.to_string();
        match e {
            BankError::NotConfigured => OpenError::NotConfigured(text),
            BankError::WrongPin => OpenError::Refused {
                message: text,
                locked: false,
            },
            BankError::Locked => OpenError::Refused {
                message: text,
                locked: true,
            },
            BankError::UnsupportedTan | BankError::Rejected(_) => OpenError::Rejected(text),
            BankError::TanPending | BankError::Connection(_) => OpenError::Upstream(text),
        }
    }

    fn fetched(data: BankData) -> Fetched {
        Fetched {
            balance: data.balance,
            balance_date: data.balance_date,
            transactions: data.transactions,
            skipped: data.skipped,
            accounts: Vec::new(),
            next_cursor: None,
        }
    }
}

#[async_trait]
impl Provider for FintsProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Fints
    }

    async fn begin(&self, req: &BeginRequest) -> Result<Step, OpenError> {
        let login = req
            .login
            .as_ref()
            .ok_or_else(|| OpenError::Rejected("blz, user_id, pin and iban are required".into()))?;
        if login.blz.trim().is_empty()
            || login.user_id.trim().is_empty()
            || login.pin.is_empty()
            || login.iban.trim().is_empty()
        {
            return Err(OpenError::Rejected(
                "blz, user_id, pin and iban are required".into(),
            ));
        }
        if let Some(minutes) = self.guard.lock().await.blocked_minutes() {
            return Err(OpenError::Paused { minutes });
        }
        let params = SyncParams {
            blz: login.blz.trim().to_string(),
            user_id: login.user_id.trim().to_string(),
            pin: login.pin.clone(),
            iban: login.iban.split_whitespace().collect(),
            bic: login.bic.trim().to_string(),
            days: req.days.clamp(1, MAX_DAYS),
            fints_url: login.fints_url.clone(),
        };
        let (pending, challenge) = match self.bank.start(&params).await {
            Ok(started) => {
                self.guard.lock().await.succeeded();
                started
            }
            Err(e) => {
                if matches!(e, BankError::WrongPin | BankError::Locked) {
                    self.guard
                        .lock()
                        .await
                        .failed(matches!(e, BankError::Locked), self.pause());
                }
                return Err(Self::error(e));
            }
        };
        let id = uuid::Uuid::new_v4().to_string();
        {
            let mut waiting = self.waiting.lock().await;
            waiting.retain(|_, w| w.started.elapsed() < STALE);
            waiting.insert(
                id.clone(),
                Waiting {
                    started: Instant::now(),
                    pending,
                },
            );
        }
        Ok(if challenge.no_tan_required {
            Step::Fetching { session: id }
        } else {
            Step::Approval {
                message: challenge.text.chars().take(500).collect(),
                session: id,
                expires_at: None,
            }
        })
    }

    async fn poll(&self, session: &str) -> Result<Poll, OpenError> {
        let mut waiting = self.waiting.lock().await;
        let Some(entry) = waiting.get_mut(session) else {
            return Err(OpenError::Rejected(
                "this sync is unknown or has expired; start it again".into(),
            ));
        };
        match entry.pending.confirm().await {
            Ok(data) => {
                waiting.remove(session);
                Ok(Poll::Data(Self::fetched(data)))
            }
            Err(BankError::TanPending) => Ok(Poll::Waiting),
            Err(e) => {
                // a failed dialog cannot be resumed
                waiting.remove(session);
                Err(Self::error(e))
            }
        }
    }

    async fn cancel(&self, session: &str) {
        self.waiting.lock().await.remove(session);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Login;
    use financer_core::Money;

    fn data() -> BankData {
        BankData {
            balance: Some(Money::from_cents(1234)),
            balance_date: None,
            transactions: vec![],
            skipped: 2,
        }
    }

    fn request() -> BeginRequest {
        BeginRequest {
            reference: "Giro".into(),
            institution: None,
            days: 30,
            login: Some(Login {
                blz: "37050198".into(),
                user_id: "mein-login-name".into(),
                pin: "98765".into(),
                iban: "DE89 3704 0044 0532 0130 00".into(),
                bic: String::new(),
                fints_url: None,
            }),
        }
    }

    fn provider(script: Vec<Result<BankData, BankError>>) -> FintsProvider {
        FintsProvider::new(Arc::new(super::super::MockBank::new(
            "Bitte bestätigen",
            script,
        )))
    }

    #[tokio::test]
    async fn a_login_asks_for_an_approval_then_the_data_comes() {
        let p = provider(vec![Err(BankError::TanPending), Ok(data())]);
        let Step::Approval {
            message, session, ..
        } = p.begin(&request()).await.unwrap()
        else {
            panic!("an approval");
        };
        assert_eq!(message, "Bitte bestätigen");
        assert_eq!(p.poll(&session).await.unwrap(), Poll::Waiting);
        let Poll::Data(got) = p.poll(&session).await.unwrap() else {
            panic!("data");
        };
        assert_eq!(
            (got.balance, got.skipped),
            (Some(Money::from_cents(1234)), 2)
        );
        // a finished sync is forgotten
        assert!(p.poll(&session).await.is_err());
    }

    #[tokio::test]
    async fn a_login_is_checked_before_the_bank_is_asked() {
        let p = provider(vec![]);
        let mut r = request();
        r.login = None;
        assert!(matches!(p.begin(&r).await, Err(OpenError::Rejected(_))));
        r = request();
        r.login.as_mut().unwrap().pin.clear();
        assert!(matches!(p.begin(&r).await, Err(OpenError::Rejected(_))));
    }

    #[tokio::test]
    async fn the_pin_never_shows_in_debug_output() {
        let shown = format!("{:?}", request());
        for secret in ["98765", "mein-login-name", "DE89"] {
            assert!(!shown.contains(secret), "{shown}");
        }
    }

    #[tokio::test]
    async fn two_wrong_pins_pause_syncing_and_a_good_login_afterwards_resets() {
        let wrong = || super::super::MockBank::failing_start(|| BankError::WrongPin);
        let p = FintsProvider::new(Arc::new(wrong()));
        p.set_pin_pause(Duration::from_millis(60));
        let first = p.begin(&request()).await.unwrap_err();
        assert!(first.refused() && !first.paused(), "{first}");
        assert!(p.begin(&request()).await.unwrap_err().refused());
        // two in a row: now paused, without asking the bank again
        assert!(p.begin(&request()).await.unwrap_err().paused());
        tokio::time::sleep(Duration::from_millis(1100)).await;
        assert!(
            p.begin(&request()).await.unwrap_err().refused(),
            "the pause ended"
        );
    }

    #[tokio::test]
    async fn a_locked_account_pauses_immediately() {
        let p = FintsProvider::new(Arc::new(super::super::MockBank::failing_start(|| {
            BankError::Locked
        })));
        assert!(p.begin(&request()).await.unwrap_err().refused());
        assert!(p.begin(&request()).await.unwrap_err().paused());
    }

    #[tokio::test]
    async fn cancelling_forgets_the_session() {
        let p = provider(vec![Ok(data())]);
        let Step::Approval { session, .. } = p.begin(&request()).await.unwrap() else {
            panic!("an approval");
        };
        p.cancel(&session).await;
        assert!(p.poll(&session).await.is_err());
    }

    #[test]
    fn bank_errors_keep_their_text() {
        let e = FintsProvider::error(BankError::Connection("down".into()));
        assert_eq!(e.to_string(), "bank connection failed: down");
        assert!(matches!(
            FintsProvider::error(BankError::NotConfigured),
            OpenError::NotConfigured(_)
        ));
    }
}
