//! Runs the real FinTS client code (`fints-rs`, through `FintsBank`) against `fints-rs`'s own
//! FinTS 3.0 mock server: real protocol messages, TAN polling and MT940 parsing, but a
//! simulated bank.
//!
//! **What this does not cover:** the mock answers TAN requests with a stub ("silently accept"),
//! so TAN challenges and polling are *not* exercised here, only login, dialogs, balance,
//! MT940 transactions and a wrong PIN. It also does not enforce its "locked PIN" or its error
//! injection flags, so locked accounts are only covered by unit tests on real response codes.
//!
//! Needs the mock server binary, so these tests skip unless `FINTS_MOCK_SERVER` points at it:
//!
//! ```sh
//! cargo install fints-rs --version 0.2.0 --features server --bin fints-server --root /tmp/fints
//! FINTS_MOCK_SERVER=/tmp/fints/bin/fints-server cargo test -p financer-fints --test mock_bank
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
        let bin = std::env::var("FINTS_MOCK_SERVER").ok()?;
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
    let (mut pending, challenge) = bank(&server).start(&params("1234")).await.expect("login");
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
    match bank(&server).start(&params("0000")).await {
        Err(BankError::WrongPin) => {}
        other => panic!(
            "expected WrongPin, got {:?}",
            other.map(|_| ()).map_err(|e| e.to_string())
        ),
    }
}

#[tokio::test]
async fn an_unreachable_bank_is_a_connection_error() {
    let dead = FintsBank::new("TESTPRODUCT").with_endpoint("GENODE23X42", "http://127.0.0.1:9");
    match dead.start(&params("1234")).await {
        Err(BankError::Connection(_)) => {}
        other => panic!(
            "expected a connection error, got {:?}",
            other.map(|_| ()).map_err(|e| e.to_string())
        ),
    }
}
