//! Fills a mail database with a demo mailbox, through the real sync (a fake mail server holds the
//! messages), so the app can be looked at and driven without a mail account.
//!
//!     cargo run -p financer-mail-api --example seed_demo -- sqlite:///tmp/mail-demo.db?mode=rwc
//!
//! Then start the server with `FINANCER_MAIL_DATABASE_URL` set to the same URL (and a
//! `FINANCER_MAIL_IMAP_HOST`, `_USERNAME` and `_PASSWORD`; the demo address is you@example.org).

use std::sync::Arc;

use financer_mail_api::config::{MailConfig, SmtpSecurity};
use financer_mail_api::store::MailStore;
use financer_mail_api::testing::FakeImap;
use financer_mail_api::MailState;
use financer_mail_core::{Address, Zone};
use time::format_description::well_known::Rfc2822;
use time::{Duration, OffsetDateTime};

fn when(ago: Duration) -> String {
    (OffsetDateTime::now_utc() - ago)
        .format(&Rfc2822)
        .expect("a date formats")
}

fn mail(
    id: &str,
    from: &str,
    to: &str,
    subject: &str,
    ago: Duration,
    extra: &str,
    body: &str,
) -> String {
    let kind = if extra.contains("Content-Type") {
        ""
    } else {
        "Content-Type: text/plain; charset=utf-8\n"
    };
    format!("From: {from}\nTo: {to}\nSubject: {subject}\nDate: {}\nMessage-ID: <{id}>\n{extra}{kind}\n{body}\n", when(ago))
}

#[tokio::main]
async fn main() {
    let url = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "sqlite://mail-demo.db?mode=rwc".into());
    let me = "Paul Meier <you@example.org>";
    let imap = FakeImap::new();
    let h = Duration::hours;
    let d = Duration::days;
    imap.deliver(
        "INBOX",
        &mail(
            "a1@x",
            "Max Müller <max@example.com>",
            me,
            "Fußball am Freitag?",
            d(2),
            "",
            "Hallo Paul,\n\nhast du Lust? Freitag um 19 Uhr auf dem Platz.\n\nLG\nMax",
        ),
        2,
    );
    imap.deliver(
        "Sent",
        &mail(
            "a2@x",
            me,
            "Max Müller <max@example.com>",
            "Re: Fußball am Freitag?",
            d(2) - h(1),
            "In-Reply-To: <a1@x>\nReferences: <a1@x>\n",
            "Klar, ich bin dabei.\n\nVG\nPaul",
        ),
        2,
    );
    imap.deliver(
        "INBOX",
        &mail(
            "a3@x",
            "Max Müller <max@example.com>",
            me,
            "Re: Fußball am Freitag?",
            h(20),
            "In-Reply-To: <a2@x>\nReferences: <a1@x> <a2@x>\n",
            "Super! Bringst du den Ball mit?\n\nAm Mo schrieb Paul Meier:\n> Klar, ich bin dabei.",
        ),
        1,
    );
    imap.deliver("INBOX", &mail("b1@x", "Max Müller <max@example.com>", me, "Wohnung besichtigen", h(3), "", "Hallo Paul,\n\nder Vermieter hat uns den Termin am Samstag um 11 Uhr gegeben. Passt das?\n\nGruß Max"), 0);
    imap.deliver("INBOX", &mail("c1@x", "Anna Berg <anna@corp.example>", me, "Einladung: Projekt-Kickoff", h(5), "MIME-Version: 1.0\nContent-Type: multipart/alternative; boundary=\"b\"\n", "--b\nContent-Type: text/plain; charset=utf-8\n\nBitte zusagen, Raum 4.\n--b\nContent-Type: text/calendar; method=REQUEST; charset=utf-8\n\nBEGIN:VCALENDAR\nMETHOD:REQUEST\nBEGIN:VEVENT\nUID:kickoff-1@corp.example\nDTSTART;TZID=Europe/Berlin:20271110T100000\nDTEND;TZID=Europe/Berlin:20271110T113000\nSUMMARY:Projekt-Kickoff\nLOCATION:Raum 4\nEND:VEVENT\nEND:VCALENDAR\n--b--"), 0);
    imap.deliver(
        "INBOX",
        &mail(
            "d1@x",
            "Shop <news@shop.example>",
            me,
            "Unsere Angebote",
            h(6),
            "List-Unsubscribe: <mailto:u@shop.example>\n",
            "20 % auf alles, nur heute.",
        ),
        0,
    );
    let store = MailStore::connect(&url).await.expect("the database opens");
    let cfg = MailConfig {
        imap_host: "imap.example.org".into(),
        imap_port: 993,
        smtp_host: "smtp.example.org".into(),
        smtp_port: 465,
        smtp_security: SmtpSecurity::Tls,
        username: "you@example.org".into(),
        password: "demo".into(),
        address: Address::parse(me).expect("an address"),
        aliases: vec![],
        inbox: "INBOX".into(),
        sent: "Sent".into(),
        poll_minutes: 0,
        max_age_days: 90,
        zone: Zone::BERLIN,
        zone_name: "Europe/Berlin".into(),
    };
    let state = MailState::new(store, Some(cfg)).with_connector(Arc::new(imap));
    state.ensure_default_templates().await.expect("templates");
    let report = state.sync_now().await.expect("sync");
    println!("{report:?}");
}
