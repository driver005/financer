//! Runs the real FinTS client code (`fints-rs`, through `FintsBank`) against `fints-rs`'s own
//! FinTS 3.0 mock server: real protocol messages, TAN polling and MT940 parsing, but a
//! simulated bank.
//!
//! The stock mock answers TAN requests with a stub ("silently accept"), so the tests that need a
//! pushTAN approval run against a patched build (`mock/build.sh`, see `FINTS_MOCK_DECOUPLED`
//! below). It also does not enforce its "locked PIN" or its error injection flags, so locked
//! accounts are only covered by unit tests on real response codes.
//!
//! Needs the mock server binary, so these tests skip unless `FINTS_MOCK_SERVER` points at the
//! stock one (login, balance, transactions, wrong PIN) and `FINTS_MOCK_DECOUPLED` at the patched
//! one built by `mock/build.sh` (pushTAN approval):
//!
//! ```sh
//! cargo install fints-rs --version 0.2.0 --features server --bin fints-server --root /tmp/fints
//! mock/build.sh /tmp/fints-decoupled
//! FINTS_MOCK_SERVER=/tmp/fints/bin/fints-server FINTS_MOCK_DECOUPLED=/tmp/fints-decoupled/fints-server \
//!   cargo test -p financer-fints --test mock_bank
//! ```
#![cfg(feature = "live")]

use std::io::BufRead;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use financer_fints::{BankClient, BankError, FintsBank, SyncParams};

struct Server {
    child: Option<Child>,
    url: String,
}

impl Server {
    fn start(args: &[&str]) -> Option<Server> {
        Self::start_with("FINTS_MOCK_SERVER", args)
    }

    fn start_with(env_var: &str, args: &[&str]) -> Option<Server> {
        let bin = std::env::var(env_var).ok()?;
        let mut child = Command::new(bin)
            .args(["--port", "0", "--print-ready"])
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("start the mock server");
        // from here on `Server`'s Drop kills and waits for the process on every path
        let mut server = Server {
            child: None,
            url: String::new(),
        };
        let stdout = child.stdout.take();
        server.child = Some(child);
        let mut line = String::new();
        std::io::BufReader::new(stdout?).read_line(&mut line).ok()?;
        let port: u16 = line.trim().strip_prefix("READY:")?.parse().ok()?;
        std::thread::sleep(Duration::from_millis(100));
        server.url = format!("http://127.0.0.1:{port}");
        Some(server)
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Sync parameters and a bank wired to the mock server.
struct Fixtures;

impl Fixtures {
    fn params(pin: &str) -> SyncParams {
        SyncParams {
            blz: "12345678".into(),
            user_id: "test1".into(),
            pin: pin.into(),
            iban: "DE89370400440532013000".into(),
            bic: "GENODE23X42".into(),
            days: 90,
        }
    }

    fn bank(server: &Server) -> FintsBank {
        FintsBank::new("TESTPRODUCT").with_endpoint("GENODE23X42", &server.url)
    }
}

macro_rules! server_or_skip {
    ($args:expr) => {
        match Server::start($args) {
            Some(s) => s,
            None => {
                eprintln!("skipping: set FINTS_MOCK_SERVER to the fints-rs mock server binary");
                return;
            }
        }
    };
}

#[tokio::test]
async fn login_balance_and_transactions_over_the_real_protocol() {
    let server = server_or_skip!(&[]);
    let (mut pending, challenge) = Fixtures::bank(&server)
        .start(&Fixtures::params("1234"))
        .await
        .expect("login");
    // this mock never asks for a TAN (see the note at the top), so no approval step
    assert!(challenge.no_tan_required);
    let data = pending.confirm().await.expect("data");
    assert_eq!(
        data.balance.expect("a balance").cents(),
        152_342,
        "the mock bank's balance is 1.523,42 EUR"
    );
    assert_eq!(
        data.transactions.len(),
        3,
        "booked transactions come through MT940 parsing"
    );
    assert_eq!(data.skipped, 0);
    for t in &data.transactions {
        assert!(t.booking_date.year() >= 2000);
        assert_ne!(t.amount.cents(), 0);
        assert_eq!(t.category, None, "categorizing is the API's job");
    }
}

#[tokio::test]
async fn a_wrong_pin_is_reported_as_wrong_pin() {
    // the mock accepts only PIN 1234
    let server = server_or_skip!(&[]);
    match Fixtures::bank(&server)
        .start(&Fixtures::params("0000"))
        .await
    {
        Err(BankError::WrongPin) => {}
        other => panic!(
            "expected WrongPin, got {:?}",
            other.map(|_| ()).map_err(|e| e.to_string())
        ),
    }
}

macro_rules! decoupled_or_skip {
    ($args:expr) => {
        match Server::start_with("FINTS_MOCK_DECOUPLED", $args) {
            Some(s) => s,
            None => {
                eprintln!(
                    "skipping: set FINTS_MOCK_DECOUPLED to the binary built by mock/build.sh"
                );
                return;
            }
        }
    };
}

#[tokio::test]
async fn pushtan_sync_waits_for_approval_then_returns_data() {
    // the mock "approves" 2 seconds after the login
    let server = decoupled_or_skip!(&["--tan-mode", "decoupled", "--auto-confirm-secs", "2"]);
    let (mut pending, challenge) = Fixtures::bank(&server)
        .start(&Fixtures::params("1234"))
        .await
        .expect("login and challenge");
    assert!(!challenge.no_tan_required, "the bank asked for an approval");
    assert!(
        challenge.text.contains("pushTAN"),
        "the bank's challenge text is passed on: {:?}",
        challenge.text
    );

    // not approved yet: the same pending sync can be polled again and again
    for _ in 0..2 {
        assert!(matches!(
            pending.confirm().await,
            Err(BankError::TanPending)
        ));
    }

    // poll like the app does (every few seconds) until the approval arrives
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    let data = loop {
        match pending.confirm().await {
            Ok(d) => break d,
            Err(BankError::TanPending) if std::time::Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(500)).await
            }
            Err(e) => panic!("unexpected error while polling: {e}"),
        }
    };
    assert_eq!(
        data.balance.expect("balance after approval").cents(),
        152_342
    );
    assert_eq!(data.transactions.len(), 3);
}

#[tokio::test]
async fn an_approval_that_never_comes_stays_pending_without_errors() {
    let server = decoupled_or_skip!(&["--tan-mode", "decoupled", "--auto-confirm-secs", "3600"]);
    let (mut pending, challenge) = Fixtures::bank(&server)
        .start(&Fixtures::params("1234"))
        .await
        .expect("login");
    assert!(!challenge.no_tan_required);
    for i in 0..6 {
        assert!(
            matches!(pending.confirm().await, Err(BankError::TanPending)),
            "poll {i}"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

#[tokio::test]
async fn a_wrong_pin_never_reaches_the_approval_step() {
    let server = decoupled_or_skip!(&["--tan-mode", "decoupled", "--auto-confirm-secs", "1"]);
    assert!(matches!(
        Fixtures::bank(&server)
            .start(&Fixtures::params("0000"))
            .await,
        Err(BankError::WrongPin)
    ));
}

#[tokio::test]
async fn an_unreachable_bank_is_a_connection_error() {
    let dead = FintsBank::new("TESTPRODUCT").with_endpoint("GENODE23X42", "http://127.0.0.1:9");
    match dead.start(&Fixtures::params("1234")).await {
        Err(BankError::Connection(_)) => {}
        other => panic!(
            "expected a connection error, got {:?}",
            other.map(|_| ()).map_err(|e| e.to_string())
        ),
    }
}
