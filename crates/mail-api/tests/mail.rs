//! The mail client end to end: a fake mail server with real-looking messages, the real router, the
//! real store (SQLite in memory) and a sender that records what would have gone out.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::Router;
use financer_mail_api::config::{MailConfig, SmtpSecurity};
use financer_mail_api::parse::parse_message;
use financer_mail_api::testing::{FakeImap, FakeSender};
use financer_mail_api::{MailApi, MailState};
use financer_mail_core::{Address, Me, Zone};
use financer_mail_store::MailStore;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

/// 2026-11-03 09:00 UTC, a Tuesday.
const NOW: i64 = 1_793_696_400;

fn config() -> MailConfig {
    MailConfig {
        imap_host: "imap.example.org".into(),
        imap_port: 993,
        smtp_host: "smtp.example.org".into(),
        smtp_port: 465,
        smtp_security: SmtpSecurity::Tls,
        username: "paul@example.org".into(),
        password: "app-password".into(),
        address: Address::parse("Paul Meier <paul@example.org>").unwrap(),
        aliases: vec![],
        inbox: "INBOX".into(),
        sent: "Sent".into(),
        poll_minutes: 5,
        max_age_days: 90,
        zone: Zone::BERLIN,
        zone_name: "Europe/Berlin".into(),
    }
}

struct World {
    app: Router,
    imap: FakeImap,
    sender: FakeSender,
}

async fn world_with(config: Option<MailConfig>) -> World {
    let store = MailStore::connect("sqlite::memory:").await.unwrap();
    let imap = FakeImap::new();
    let sender = FakeSender::new();
    let state = MailState::new(store, config)
        .with_connector(Arc::new(imap.clone()))
        .with_sender(Arc::new(sender.clone()))
        .with_clock(Arc::new(|| NOW));
    World {
        app: MailApi::router(state),
        imap,
        sender,
    }
}

async fn world() -> World {
    world_with(Some(config())).await
}

impl World {
    async fn call(&self, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri(path);
        let body = match body {
            Some(b) => {
                req = req.header("content-type", "application/json");
                Body::from(b.to_string())
            }
            None => Body::empty(),
        };
        let res = self
            .app
            .clone()
            .oneshot(req.body(body).unwrap())
            .await
            .unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let json = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .unwrap_or(Value::String(String::from_utf8_lossy(&bytes).into()))
        };
        (status, json)
    }
    async fn get(&self, path: &str) -> Value {
        let (status, body) = self.call("GET", path, None).await;
        assert_eq!(status, StatusCode::OK, "GET {path}: {body}");
        body
    }
    async fn post(&self, path: &str, body: Value) -> (StatusCode, Value) {
        self.call("POST", path, Some(body)).await
    }
    async fn sync(&self) -> Value {
        let (status, body) = self.post("/sync", json!({})).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        body
    }
    fn people(&self, v: &Value) -> Vec<String> {
        v["conversations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["title"].as_str().unwrap().to_string())
            .collect()
    }
}

fn mail(
    id: &str,
    from: &str,
    to: &str,
    subject: &str,
    date: &str,
    extra: &str,
    body: &str,
) -> String {
    format!("From: {from}\nTo: {to}\nSubject: {subject}\nDate: {date}\nMessage-ID: <{id}>\n{extra}Content-Type: text/plain; charset=utf-8\n\n{body}\n")
}

const MAX: &str = "Max Müller <max@example.com>";
const PAUL: &str = "Paul Meier <paul@example.org>";

/// A small mailbox: a friend arranging a meeting, a reply in the sent folder, a newsletter.
fn stock(imap: &FakeImap) {
    imap.deliver(
        "INBOX",
        &mail(
            "m1@example.com",
            MAX,
            PAUL,
            "Fußball am Freitag?",
            "Mon, 02 Nov 2026 18:00:00 +0100",
            "",
            "Hallo Paul,\n\nhast du Lust? Freitag um 19 Uhr auf dem Platz.\n\nLG\nMax",
        ),
        1,
    );
    imap.deliver(
        "INBOX",
        &mail(
            "m2@example.com",
            MAX,
            PAUL,
            "Re: Fußball am Freitag?",
            "Tue, 03 Nov 2026 08:00:00 +0100",
            "In-Reply-To: <s1@example.org>\nReferences: <m1@example.com> <s1@example.org>\n",
            "Super!\n\nAm 02.11.2026 um 19:00 schrieb Paul Meier:\n> Klar, ich bin dabei.\n",
        ),
        0,
    );
    imap.deliver(
        "INBOX",
        &mail(
            "n1@shop.de",
            "Shop <news@shop.de>",
            PAUL,
            "Unsere Angebote",
            "Tue, 03 Nov 2026 07:00:00 +0100",
            "List-Unsubscribe: <mailto:u@shop.de>\n",
            "Webinar am 12.11. um 18 Uhr! Nur heute 20 % Rabatt.",
        ),
        0,
    );
    imap.deliver(
        "Sent",
        &mail(
            "s1@example.org",
            PAUL,
            MAX,
            "Re: Fußball am Freitag?",
            "Mon, 02 Nov 2026 19:00:00 +0100",
            "In-Reply-To: <m1@example.com>\nReferences: <m1@example.com>\n",
            "Klar, ich bin dabei.\n\nVG\nPaul",
        ),
        1,
    );
}

#[tokio::test]
async fn syncing_builds_a_chat_per_person_and_keeps_newsletters_apart() {
    let w = world().await;
    stock(&w.imap);
    let report = w.sync().await;
    assert_eq!(report["stored"], 4);
    assert_eq!(report["error"], Value::Null);

    let people = w.get("/conversations").await;
    assert_eq!(
        w.people(&people),
        ["Max Müller"],
        "the newsletter is not a person"
    );
    let max = &people["conversations"][0];
    assert_eq!(
        max["count"], 3,
        "two received and one sent message in one chat"
    );
    assert_eq!(
        max["unread"], 0,
        "mail that was already there when connecting starts as read"
    );
    assert_eq!(max["last_from_me"], false);
    assert_eq!(max["preview"], "Super!");
    assert_eq!(max["topics"], json!(["Fußball am Freitag?"]));

    let updates = w.get("/conversations?scope=updates").await;
    assert_eq!(w.people(&updates), ["Shop"]);
    assert_eq!(
        w.get("/conversations?scope=all").await["conversations"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn the_chat_shows_what_was_said_in_order_without_quotes_greetings_and_closings() {
    let w = world().await;
    stock(&w.imap);
    w.sync().await;
    let key = w.get("/conversations").await["conversations"][0]["key"]
        .as_str()
        .unwrap()
        .to_string();
    let chat = w.get(&format!("/conversations/{key}")).await;
    let texts: Vec<_> = chat["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["text"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        texts,
        [
            "hast du Lust? Freitag um 19 Uhr auf dem Platz.",
            "Klar, ich bin dabei.",
            "Super!"
        ]
    );
    let mine: Vec<_> = chat["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["mine"].as_bool().unwrap())
        .collect();
    assert_eq!(mine, [false, true, false]);
    assert_eq!(chat["messages"][2]["trimmed"], true);
    assert_eq!(chat["reply_to"][0]["email"], "max@example.com");
    assert!(chat["reply_to_message"].is_number());
}

#[tokio::test]
async fn topics_join_a_thread_across_inbox_and_sent_folder() {
    let w = world().await;
    stock(&w.imap);
    w.sync().await;
    let topics = w.get("/conversations?by=topic&scope=all").await;
    let titles = w.people(&topics);
    assert!(
        titles.contains(&"Fußball am Freitag?".to_string()),
        "{titles:?}"
    );
    let thread = topics["conversations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["title"] == "Fußball am Freitag?")
        .unwrap();
    assert_eq!(thread["count"], 3);
    assert_eq!(thread["kind"], "topic");
    assert!(thread["key"].as_str().unwrap().starts_with("t-"));
}

#[tokio::test]
async fn an_appointment_in_a_mail_lands_in_the_calendar_and_shows_in_the_chat() {
    let w = world().await;
    stock(&w.imap);
    let report = w.sync().await;
    assert_eq!(
        report["events"], 1,
        "Friday 19 Uhr; the newsletter's webinar is not an appointment"
    );
    let cal = w.get("/events?from=2026-11-01&to=2026-11-30").await;
    let events = cal["events"].as_array().unwrap();
    assert_eq!(events.len(), 1, "{cal}");
    assert_eq!(events[0]["title"], "Fußball am Freitag?");
    assert_eq!(events[0]["start"], "2026-11-06T19:00");
    assert_eq!(events[0]["source"], "text");
    // it hangs under the bubble it came from
    let key = w.get("/conversations").await["conversations"][0]["key"]
        .as_str()
        .unwrap()
        .to_string();
    let chat = w.get(&format!("/conversations/{key}")).await;
    assert_eq!(
        chat["messages"][0]["events"][0]["start"],
        "2026-11-06T19:00"
    );
}

#[tokio::test]
async fn an_invitation_is_added_exactly_and_a_cancellation_removes_it() {
    let w = world().await;
    let invite = |method: &str, seq: u32, status: &str| {
        let ics = format!(
            "BEGIN:VCALENDAR\nVERSION:2.0\nMETHOD:{method}\nBEGIN:VEVENT\nUID:kickoff-1@corp.example\nSEQUENCE:{seq}\nDTSTART;TZID=Europe/Berlin:20261110T100000\nDTEND;TZID=Europe/Berlin:20261110T113000\nSUMMARY:Projekt-Kickoff\nLOCATION:Raum 4\n{status}END:VEVENT\nEND:VCALENDAR\n"
        );
        format!(
            "From: Anna Berg <anna@corp.example>\nTo: {PAUL}\nSubject: Einladung: Projekt-Kickoff\nDate: Tue, 03 Nov 2026 08:30:00 +0100\nMessage-ID: <inv-{seq}@corp.example>\nMIME-Version: 1.0\nContent-Type: multipart/alternative; boundary=\"b\"\n\n--b\nContent-Type: text/plain; charset=utf-8\n\nBitte zusagen.\n--b\nContent-Type: text/calendar; method={method}; charset=utf-8\n\n{ics}--b--\n"
        )
    };
    w.imap.deliver("INBOX", &invite("REQUEST", 0, ""), 0);
    w.imap.deliver(
        "Sent",
        &mail(
            "x@example.org",
            PAUL,
            "anna@corp.example",
            "Hi",
            "Mon, 02 Nov 2026 19:00:00 +0100",
            "",
            "Hallo",
        ),
        1,
    );
    w.sync().await;
    let cal = w.get("/events?from=2026-11-01&to=2026-11-30").await;
    let e = &cal["events"][0];
    assert_eq!(
        (e["title"].as_str(), e["start"].as_str(), e["end"].as_str()),
        (
            Some("Projekt-Kickoff"),
            Some("2026-11-10T10:00"),
            Some("2026-11-10T11:30")
        )
    );
    assert_eq!(e["location"], "Raum 4");
    assert_eq!(e["source"], "invite");

    w.imap
        .deliver("INBOX", &invite("CANCEL", 1, "STATUS:CANCELLED\n"), 0);
    w.sync().await;
    assert!(
        w.get("/events?from=2026-11-01&to=2026-11-30").await["events"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let all = w
        .get("/events?from=2026-11-01&to=2026-11-30&include_cancelled=true")
        .await;
    assert_eq!(all["events"][0]["status"], "cancelled");
}

#[tokio::test]
async fn a_removed_event_stays_removed_when_the_mail_is_read_again() {
    let w = world().await;
    stock(&w.imap);
    w.sync().await;
    let id = w.get("/events?from=2026-11-01&to=2026-11-30").await["events"][0]["id"]
        .as_i64()
        .unwrap();
    assert_eq!(
        w.call("DELETE", &format!("/events/{id}"), None).await.0,
        StatusCode::NO_CONTENT
    );
    assert!(
        w.get("/events?from=2026-11-01&to=2026-11-30").await["events"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    // the server renumbers the folder: every message is read again
    w.imap.renumber("INBOX", 2);
    let report = w.sync().await;
    assert_eq!(report["stored"], 0, "{report}");
    assert!(
        w.get("/events?from=2026-11-01&to=2026-11-30").await["events"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let (status, back) = w.post(&format!("/events/{id}/restore"), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{back}");
    assert_eq!(
        w.get("/events?from=2026-11-01&to=2026-11-30").await["events"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn new_mail_after_the_first_sync_is_unread_until_the_chat_is_opened() {
    let w = world().await;
    stock(&w.imap);
    w.sync().await;
    w.imap.deliver(
        "INBOX",
        &mail(
            "m3@example.com",
            MAX,
            PAUL,
            "Re: Fußball am Freitag?",
            "Tue, 03 Nov 2026 09:30:00 +0100",
            "In-Reply-To: <m2@example.com>\n",
            "Kann doch erst um 20 Uhr.",
        ),
        0,
    );
    let report = w.sync().await;
    assert_eq!(report["stored"], 1);
    let list = w.get("/conversations").await;
    assert_eq!(list["conversations"][0]["unread"], 1);
    assert_eq!(list["unread_people"], 1);
    assert_eq!(w.get("/info").await["unread"], 1);
    let key = list["conversations"][0]["key"].as_str().unwrap();
    let (status, marked) = w
        .post(&format!("/conversations/{key}/read"), json!({}))
        .await;
    assert_eq!(
        (status, marked["marked"].as_i64()),
        (StatusCode::OK, Some(1))
    );
    assert_eq!(w.get("/conversations").await["unread_people"], 0);
}

#[tokio::test]
async fn the_server_is_only_read_never_changed() {
    let w = world().await;
    stock(&w.imap);
    w.sync().await;
    assert!(
        w.imap.selected().iter().all(|(_, read_only)| *read_only),
        "every folder is opened with EXAMINE: {:?}",
        w.imap.selected()
    );
    assert_eq!(
        w.imap.last_login(),
        Some(("paul@example.org".into(), "app-password".into()))
    );
    // FakeImap panics if mark_seen is ever called
}

#[tokio::test]
async fn a_second_sync_downloads_only_what_is_new() {
    let w = world().await;
    stock(&w.imap);
    w.sync().await;
    let before = w.imap.fetched().len();
    let report = w.sync().await;
    assert_eq!(
        (report["fetched"].as_i64(), report["stored"].as_i64()),
        (Some(0), Some(0))
    );
    assert_eq!(w.imap.fetched().len(), before);
}

#[tokio::test]
async fn a_dropped_connection_keeps_what_was_downloaded_and_the_next_sync_continues() {
    let w = world().await;
    stock(&w.imap);
    w.imap.fail_fetch(2); // the second inbox message
    let first = w.sync().await;
    assert!(
        first["error"].as_str().unwrap().contains("INBOX"),
        "{first}"
    );
    assert!(first["stored"].as_i64().unwrap() >= 1);
    let second = w.sync().await;
    assert_eq!(second["error"], Value::Null, "{second}");
    assert_eq!(
        w.get("/info").await["messages"],
        4,
        "nothing lost, nothing twice"
    );
}

#[tokio::test]
async fn an_unreachable_server_is_reported_not_fatal() {
    let w = world().await;
    w.imap.fail_next_connect("connection refused");
    let report = w.sync().await;
    assert!(report["error"]
        .as_str()
        .unwrap()
        .contains("connection refused"));
    let info = w.get("/info").await;
    assert_eq!(info["last_sync"]["error"], report["error"]);
    assert_eq!(info["syncing"], false);
}

#[tokio::test]
async fn a_message_without_a_sender_is_skipped_and_counted() {
    let w = world().await;
    w.imap.deliver(
        "INBOX",
        "Subject: ohne Absender\nMessage-ID: <x@y>\n\nText",
        0,
    );
    w.imap.deliver(
        "Sent",
        &mail(
            "s@x",
            PAUL,
            MAX,
            "x",
            "Mon, 02 Nov 2026 19:00:00 +0100",
            "",
            "y",
        ),
        0,
    );
    let report = w.sync().await;
    assert_eq!(
        (report["skipped"].as_i64(), report["stored"].as_i64()),
        (Some(1), Some(1))
    );
}

// ---- sending and templates ----------------------------------------------------------------------

#[tokio::test]
async fn sending_wraps_the_text_in_the_templates_for_that_person() {
    let w = world().await;
    // "Lieber Max," for Max, "VG Paul" below
    let (_, dear) = w.post("/templates", json!({"kind": "greeting", "name": "Max", "text": "Lieber {first_name},", "audience": ["max@example.com"]})).await;
    assert!(dear["id"].is_number(), "{dear}");
    w.post(
        "/templates",
        json!({"kind": "closing", "name": "VG", "text": "VG\n{my_first_name}", "is_default": true}),
    )
    .await;
    let (status, sent) = w.post("/send", json!({"to": ["Max Müller <max@example.com>"], "subject": "Fußball", "body": "Kommst du Freitag?"})).await;
    assert_eq!(status, StatusCode::CREATED, "{sent}");
    assert_eq!(
        sent["text"],
        "Lieber Max,\n\nKommst du Freitag?\n\nVG\nPaul"
    );

    let out = w.sender.sent();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].from, "paul@example.org");
    assert_eq!(out[0].recipients, ["max@example.com"]);
    let raw = String::from_utf8_lossy(&out[0].raw);
    let parsed = parse_message(
        &out[0].raw,
        "Sent",
        None,
        true,
        &Me::new(["paul@example.org"]),
        NOW,
    )
    .unwrap()
    .message;
    assert_eq!(parsed.subject, "Fußball");
    assert_eq!(
        parsed.body.trim_end(),
        "Lieber Max,\n\nKommst du Freitag?\n\nVG\nPaul"
    );
    let _ = raw;

    // it is in the chat straight away
    let list = w.get("/conversations").await;
    assert_eq!(
        list["conversations"][0]["title"], "Max Müller",
        "the name given in the To field"
    );
    assert_eq!(list["conversations"][0]["last_from_me"], true);
    let key = list["conversations"][0]["key"].as_str().unwrap();
    let chat = w.get(&format!("/conversations/{key}")).await;
    assert_eq!(
        chat["messages"][0]["text"], "Kommst du Freitag?",
        "the bubble shows what was said, not the frame"
    );
    assert_eq!(chat["messages"][0]["mine"], true);
}

#[tokio::test]
async fn templates_can_be_picked_switched_off_or_left_to_the_default() {
    let w = world().await;
    let (_, tpls) = (StatusCode::OK, w.get("/templates").await);
    let list = tpls["templates"].as_array().unwrap();
    assert!(
        list.len() >= 4,
        "a starting set is created the first time: {tpls}"
    );
    assert!(tpls["placeholders"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["name"] == "first_name"));
    let find = |name: &str| {
        list.iter().find(|t| t["name"] == name).unwrap()["id"]
            .as_i64()
            .unwrap()
    };

    let req = |g: Value, c: Value| json!({"to": ["max@example.com"], "body": "Passt.", "greeting": g, "closing": c});
    let (_, auto) = w
        .post("/compose/preview", req(json!("auto"), json!("auto")))
        .await;
    assert_eq!(
        auto["text"], "Hallo Max,\n\nPasst.\n\nVG\nPaul",
        "defaults: friendly greeting, short closing"
    );
    let (_, none) = w
        .post("/compose/preview", req(json!("none"), json!("none")))
        .await;
    assert_eq!(none["text"], "Passt.");
    let (_, chosen) = w
        .post(
            "/compose/preview",
            req(json!({"id": find("Dear")}), json!({"id": find("Formal")})),
        )
        .await;
    assert_eq!(
        chosen["text"],
        "Lieber Max,\n\nPasst.\n\nMit freundlichen Grüßen\nPaul Meier"
    );
    assert_eq!(chosen["greeting"]["name"], "Dear");
    let (status, missing) = w
        .post("/compose/preview", req(json!({"id": 9999}), json!("none")))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{missing}");
}

#[tokio::test]
async fn the_preview_warns_when_it_cannot_do_what_the_template_says() {
    let w = world().await;
    let (_, p) = w.post("/compose/preview", json!({"to": ["info@firma.de"], "body": "Anfrage zum Angebot.", "greeting": "auto", "closing": "none"})).await;
    // the friendly default has the fallback "Hallo,"
    assert_eq!(p["text"], "Hallo,\n\nAnfrage zum Angebot.");
    let list = w.get("/templates").await;
    let dear = list["templates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "Dear")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let (_, p) = w.post("/compose/preview", json!({"to": ["info@firma.de"], "body": "Anfrage.", "greeting": {"id": dear}, "closing": "none"})).await;
    assert_eq!(p["text"], "Anfrage.");
    assert!(
        p["warnings"][0]
            .as_str()
            .unwrap()
            .contains("greeting was left out"),
        "{p}"
    );
    let (_, p) = w.post("/compose/preview", json!({"to": ["max@example.com"], "body": "Hallo Max,\n\nja.\n\nLG Paul", "greeting": "auto", "closing": "auto"})).await;
    assert_eq!(
        p["text"], "Hallo Max,\n\nja.\n\nLG Paul",
        "what you typed yourself is kept"
    );
    assert_eq!(p["warnings"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn a_reply_stays_in_the_thread() {
    let w = world().await;
    stock(&w.imap);
    w.sync().await;
    let key = w.get("/conversations").await["conversations"][0]["key"]
        .as_str()
        .unwrap()
        .to_string();
    let chat = w.get(&format!("/conversations/{key}")).await;
    let parent = chat["reply_to_message"].as_i64().unwrap();
    let (status, sent) = w.post("/send", json!({"to": ["max@example.com"], "body": "Bis Freitag!", "reply_to": parent, "greeting": "none", "closing": "none"})).await;
    assert_eq!(status, StatusCode::CREATED, "{sent}");
    let raw = String::from_utf8_lossy(&w.sender.sent()[0].raw).to_string();
    assert!(raw.contains("In-Reply-To: <m2@example.com>"), "{raw}");
    assert!(
        raw.contains("References: <m1@example.com> <s1@example.org> <m2@example.com>"),
        "{raw}"
    );
    let parsed = parse_message(
        &w.sender.sent()[0].raw,
        "Sent",
        None,
        true,
        &Me::new(["paul@example.org"]),
        NOW,
    )
    .unwrap()
    .message;
    assert_eq!(
        parsed.subject, "Re: Fußball am Freitag?",
        "the subject is the topic with Re:"
    );
    // and it is part of the same topic
    let topics = w.get("/conversations?by=topic&scope=all").await;
    let t = topics["conversations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["title"] == "Fußball am Freitag?")
        .unwrap();
    assert_eq!(t["count"], 4);
}

#[tokio::test]
async fn bcc_goes_to_the_server_but_not_into_the_message() {
    let w = world().await;
    let (status, _) = w.post("/send", json!({"to": ["max@example.com"], "bcc": ["boss@example.org"], "subject": "x", "body": "y", "greeting": "none", "closing": "none"})).await;
    assert_eq!(status, StatusCode::CREATED);
    let sent = &w.sender.sent()[0];
    assert_eq!(sent.recipients, ["max@example.com", "boss@example.org"]);
    assert!(!String::from_utf8_lossy(&sent.raw).contains("boss@example.org"));
}

#[tokio::test]
async fn sending_refuses_what_cannot_work() {
    let w = world().await;
    let send = |v: Value| w.post("/send", v);
    let (s, e) = send(json!({"to": [], "subject": "x", "body": "y"})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(e["error"].as_str().unwrap().contains("recipient"), "{e}");
    let (s, e) = send(json!({"to": ["not an address"], "subject": "x", "body": "y"})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(
        e["problems"][0]
            .as_str()
            .unwrap()
            .contains("not an address"),
        "{e}"
    );
    let (s, _) = send(json!({"to": ["max@example.com"], "subject": "x", "body": "   "})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, e) = send(json!({"to": ["max@example.com"], "body": "ohne Betreff"})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(e["error"].as_str().unwrap().contains("subject"), "{e}");
    let (s, _) =
        send(json!({"to": ["max@example.com"], "subject": "x", "body": "y", "reply_to": 9999}))
            .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(w.sender.sent().is_empty(), "nothing went out");
}

#[tokio::test]
async fn a_refused_message_is_a_bad_gateway_and_is_not_stored() {
    let w = world().await;
    w.sender.fail_next("550 5.7.1 relay denied");
    let (status, e) = w
        .post(
            "/send",
            json!({"to": ["max@example.com"], "subject": "x", "body": "y"}),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert!(e["error"].as_str().unwrap().contains("550"), "{e}");
    assert_eq!(
        w.get("/info").await["messages"],
        0,
        "a message that was not sent is not in the chat"
    );
}

#[tokio::test]
async fn sending_an_appointment_puts_it_in_the_calendar_too() {
    let w = world().await;
    w.post("/send", json!({"to": ["max@example.com"], "subject": "Kaffee", "body": "Morgen um 15 Uhr im Café?", "greeting": "none", "closing": "none"})).await;
    let cal = w.get("/events?from=2026-11-01&to=2026-11-30").await;
    assert_eq!(cal["events"][0]["start"], "2026-11-04T15:00");
}

#[tokio::test]
async fn the_copy_in_the_sent_folder_is_not_stored_twice() {
    let w = world().await;
    let (_, sent) = w.post("/send", json!({"to": ["max@example.com"], "subject": "x", "body": "y", "greeting": "none", "closing": "none"})).await;
    // the provider keeps a copy under the same Message-ID, which the next sync finds
    let id = sent["message_id"].as_str().unwrap();
    w.imap.deliver(
        "INBOX",
        &mail(
            "i@x",
            MAX,
            PAUL,
            "Hi",
            "Tue, 03 Nov 2026 08:00:00 +0100",
            "",
            "hi",
        ),
        0,
    );
    w.imap.deliver(
        "Sent",
        &mail(
            id,
            PAUL,
            MAX,
            "x",
            "Tue, 03 Nov 2026 09:00:00 +0100",
            "",
            "y",
        ),
        0,
    );
    let report = w.sync().await;
    assert_eq!(
        (report["duplicates"].as_i64(), report["stored"].as_i64()),
        (Some(1), Some(1))
    );
}

#[tokio::test]
async fn template_validation_and_crud() {
    let w = world().await;
    let (s, e) = w.post("/templates", json!({"kind": "greeting", "name": "", "text": "Hallo {vorname},", "audience": ["kaputt"]})).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(e["problems"].as_array().unwrap().len() >= 3, "{e}");
    let (s, t) = w.post("/templates", json!({"kind": "closing", "name": "Kurz", "text": "LG {my_first_name}", "is_default": true})).await;
    assert_eq!(s, StatusCode::CREATED, "{t}");
    let id = t["id"].as_i64().unwrap();
    let (s, updated) = w.call("PUT", &format!("/templates/{id}"), Some(json!({"kind": "closing", "name": "Kürzer", "text": "LG\n{my_first_name}", "is_default": true}))).await;
    assert_eq!(
        (s, updated["name"].as_str()),
        (StatusCode::OK, Some("Kürzer"))
    );
    assert_eq!(
        w.call(
            "PUT",
            "/templates/9999",
            Some(json!({"kind": "closing", "name": "x", "text": "y"}))
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        w.call("DELETE", &format!("/templates/{id}"), None).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        w.call("DELETE", &format!("/templates/{id}"), None).await.0,
        StatusCode::NOT_FOUND
    );
    // deleting everything does not bring the starting set back
    for t in w.get("/templates").await["templates"].as_array().unwrap() {
        w.call("DELETE", &format!("/templates/{}", t["id"]), None)
            .await;
    }
    assert!(w.get("/templates").await["templates"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn events_can_be_added_by_hand() {
    let w = world().await;
    let (s, e) = w.post("/events", json!({"title": "Zahnarzt", "start": "2026-11-12T08:30", "end": "2026-11-12T09:15", "location": "Praxis Dr. Berg"})).await;
    assert_eq!(s, StatusCode::CREATED, "{e}");
    assert_eq!(
        (e["source"].as_str(), e["title"].as_str()),
        (Some("manual"), Some("Zahnarzt"))
    );
    let (s, all_day) = w
        .post(
            "/events",
            json!({"title": "Urlaub", "start": "2026-12-20", "end": "2026-12-27", "all_day": true}),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{all_day}");
    let cal = w.get("/events?from=2026-12-24&to=2026-12-24").await;
    assert_eq!(
        cal["events"][0]["title"], "Urlaub",
        "an event that spans the day is listed for it"
    );
    assert_eq!(
        w.post(
            "/events",
            json!({"title": " ", "start": "2026-11-12T08:30"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        w.post("/events", json!({"title": "x", "start": "12.11.2026"}))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        w.post(
            "/events",
            json!({"title": "x", "start": "2026-11-12T10:00", "end": "2026-11-12T09:00"})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        w.call("GET", "/events?from=2026-11-30&to=2026-11-01", None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        w.call("DELETE", "/events/9999", None).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn without_a_mailbox_the_templates_and_calendar_still_work() {
    let w = world_with(None).await;
    let info = w.get("/info").await;
    assert_eq!(info["configured"], false);
    assert_eq!(
        w.post("/sync", json!({})).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        w.post(
            "/send",
            json!({"to": ["max@example.com"], "subject": "x", "body": "y"})
        )
        .await
        .0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert!(!w.get("/templates").await["templates"]
        .as_array()
        .unwrap()
        .is_empty());
    let (s, p) = w
        .post(
            "/compose/preview",
            json!({"to": ["max@example.com"], "body": "Hi"}),
        )
        .await;
    assert_eq!(s, StatusCode::OK, "{p}");
    assert_eq!(
        w.post(
            "/events",
            json!({"title": "x", "start": "2026-11-12T08:30"})
        )
        .await
        .0,
        StatusCode::CREATED
    );
    assert!(w.get("/conversations").await["conversations"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn bad_requests_and_unknown_keys() {
    let w = world().await;
    assert_eq!(
        w.call("GET", "/conversations?by=colour", None).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        w.call("GET", "/conversations?scope=everything", None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        w.call("GET", "/conversations/p-000000000000", None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        w.call("GET", "/conversations/nonsense", None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        w.call("GET", "/messages/12345", None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        w.call("GET", "/nothing-here", None).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn search_finds_people_topics_and_text() {
    let w = world().await;
    stock(&w.imap);
    w.sync().await;
    assert_eq!(
        w.people(&w.get("/conversations?q=müller").await),
        ["Max Müller"]
    );
    assert_eq!(
        w.people(&w.get("/conversations?q=Fußball").await),
        ["Max Müller"]
    );
    assert!(w.get("/conversations?q=gibtsnicht").await["conversations"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn the_original_message_with_its_quote_stays_available() {
    let w = world().await;
    stock(&w.imap);
    w.sync().await;
    let key = w.get("/conversations").await["conversations"][0]["key"]
        .as_str()
        .unwrap()
        .to_string();
    let id = w.get(&format!("/conversations/{key}")).await["messages"][2]["id"]
        .as_i64()
        .unwrap();
    let m = w.get(&format!("/messages/{id}")).await;
    assert!(m["body"]
        .as_str()
        .unwrap()
        .contains("> Klar, ich bin dabei."));
    assert_eq!(m["folder"], "INBOX");
}
