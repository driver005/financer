//! The SDK against the real mail router (no network): every call, and how errors come back.

use std::sync::Arc;

use async_trait::async_trait;
use axum::body::Body;
use axum::http::Request as HttpRequest;
use axum::Router;
use financer_mail_api::config::{MailConfig, SmtpSecurity};
use financer_mail_api::store::MailStore;
use financer_mail_api::testing::{FakeImap, FakeSender};
use financer_mail_api::{MailApi, MailState};
use financer_mail_core::wire::{Choice, NewEvent, PreviewRequest, SendRequest};
use financer_mail_core::{Address, ConversationKind, Template, TemplateKind, Zone};
use financer_sdk::{MailSdk, Request, Response, SdkError, Transport};
use http_body_util::BodyExt;
use tower::ServiceExt;

/// 2026-11-03 09:00 UTC.
const NOW: i64 = 1_793_696_400;

/// Calls the server's router in the same process: what the app does when the backend runs inside it.
struct InProcess(Router);

#[async_trait]
impl Transport for InProcess {
    async fn send(&self, r: Request) -> Result<Response, SdkError> {
        let mut req = HttpRequest::builder()
            .method(r.method.as_str())
            .uri(r.path.as_str());
        let body = match r.body {
            Some(b) => {
                req = req.header("content-type", "application/json");
                Body::from(b)
            }
            None => Body::empty(),
        };
        let res = self
            .0
            .clone()
            .oneshot(req.body(body).unwrap())
            .await
            .map_err(|e| SdkError::Network {
                message: e.to_string(),
            })?;
        let status = res.status().as_u16();
        let body = res
            .into_body()
            .collect()
            .await
            .map_err(|e| SdkError::Network {
                message: e.to_string(),
            })?
            .to_bytes()
            .to_vec();
        Ok(Response { status, body })
    }
}

fn config() -> MailConfig {
    MailConfig {
        imap_host: "imap.example.org".into(),
        imap_port: 993,
        smtp_host: "smtp.example.org".into(),
        smtp_port: 465,
        smtp_security: SmtpSecurity::Tls,
        username: "paul@example.org".into(),
        password: "pw".into(),
        address: Address::parse("Paul Meier <paul@example.org>").unwrap(),
        aliases: vec![],
        inbox: "INBOX".into(),
        sent: "Sent".into(),
        poll_minutes: 0,
        max_age_days: 90,
        zone: Zone::BERLIN,
        zone_name: "Europe/Berlin".into(),
    }
}

struct World {
    sdk: Arc<MailSdk>,
    imap: FakeImap,
    sender: FakeSender,
}

async fn world(configured: bool) -> World {
    let store = MailStore::connect("sqlite::memory:").await.unwrap();
    let imap = FakeImap::new();
    let sender = FakeSender::new();
    let state = MailState::new(store, configured.then(config))
        .with_connector(Arc::new(imap.clone()))
        .with_sender(Arc::new(sender.clone()))
        .with_clock(Arc::new(|| NOW));
    let app = Router::new().nest("/v1/mail", MailApi::router(state));
    World {
        sdk: MailSdk::with_transport(Arc::new(InProcess(app))),
        imap,
        sender,
    }
}

fn mail(id: &str, from: &str, subject: &str, date: &str, extra: &str, body: &str) -> String {
    let to = if from.contains("paul@example.org") {
        "Max Müller <max@example.com>"
    } else {
        "Paul Meier <paul@example.org>"
    };
    format!("From: {from}\nTo: {to}\nSubject: {subject}\nDate: {date}\nMessage-ID: <{id}>\n{extra}Content-Type: text/plain; charset=utf-8\n\n{body}\n")
}

fn stock(imap: &FakeImap) {
    imap.deliver(
        "INBOX",
        &mail(
            "m1@x",
            "Max Müller <max@example.com>",
            "Fußball am Freitag?",
            "Mon, 02 Nov 2026 18:00:00 +0100",
            "",
            "Hallo Paul,\n\nhast du Lust? Freitag um 19 Uhr.\n\nLG\nMax",
        ),
        1,
    );
    imap.deliver(
        "INBOX",
        &mail(
            "n1@shop",
            "Shop <news@shop.de>",
            "Angebote",
            "Tue, 03 Nov 2026 07:00:00 +0100",
            "List-Unsubscribe: <mailto:u@shop.de>\n",
            "Sale",
        ),
        0,
    );
    imap.deliver(
        "Sent",
        &mail(
            "s1@x",
            "Paul Meier <paul@example.org>",
            "Re: Fußball am Freitag?",
            "Mon, 02 Nov 2026 19:00:00 +0100",
            "In-Reply-To: <m1@x>\nReferences: <m1@x>\n",
            "Klar.\n\nVG\nPaul",
        ),
        1,
    );
}

#[tokio::test]
async fn info_sync_and_the_chat_lists() {
    let w = world(true).await;
    stock(&w.imap);
    let info = w.sdk.info().await.unwrap();
    assert!(info.configured && info.last_sync.is_none());
    assert_eq!(info.address.unwrap().email, "paul@example.org");

    let report = w.sdk.sync().await.unwrap();
    assert_eq!((report.stored, report.events, report.error), (3, 1, None));

    let people = w.sdk.conversations(None, None, None, None).await.unwrap();
    assert_eq!(
        people.conversations.len(),
        1,
        "the newsletter is kept apart"
    );
    let max = &people.conversations[0];
    assert_eq!(
        (max.title.as_str(), max.count, max.kind),
        ("Max Müller", 2, ConversationKind::Person)
    );

    let updates = w
        .sdk
        .conversations(None, Some("updates".into()), None, None)
        .await
        .unwrap();
    assert_eq!(updates.conversations[0].title, "Shop");
    let topics = w
        .sdk
        .conversations(
            Some("topic".into()),
            Some("all".into()),
            Some("  Fußball ".into()),
            Some(5),
        )
        .await
        .unwrap();
    assert_eq!(
        (topics.conversations.len(), topics.conversations[0].kind),
        (1, ConversationKind::Topic)
    );
    assert!(w
        .sdk
        .conversations(None, None, Some("nothing like this".into()), None)
        .await
        .unwrap()
        .conversations
        .is_empty());
}

#[tokio::test]
async fn a_chat_its_bubbles_and_marking_it_read() {
    let w = world(true).await;
    stock(&w.imap);
    w.sdk.sync().await.unwrap();
    w.imap.deliver(
        "INBOX",
        &mail(
            "m2@x",
            "Max Müller <max@example.com>",
            "Re: Fußball am Freitag?",
            "Tue, 03 Nov 2026 09:30:00 +0100",
            "In-Reply-To: <m1@x>\n",
            "Ich bringe den Ball mit.",
        ),
        0,
    );
    w.sdk.sync().await.unwrap();
    let key = w
        .sdk
        .conversations(None, None, None, None)
        .await
        .unwrap()
        .conversations[0]
        .key
        .clone();
    assert_eq!(
        w.sdk
            .conversations(None, None, None, None)
            .await
            .unwrap()
            .unread_people,
        1
    );

    let chat = w.sdk.conversation(key.clone()).await.unwrap();
    let texts: Vec<_> = chat.messages.iter().map(|m| m.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "hast du Lust? Freitag um 19 Uhr.",
            "Klar.",
            "Ich bringe den Ball mit."
        ]
    );
    assert_eq!(
        chat.messages.iter().map(|m| m.mine).collect::<Vec<_>>(),
        [false, true, false]
    );
    assert!(chat.messages[0].events[0]
        .start
        .starts_with("2026-11-06T19:00"));
    assert_eq!(chat.reply_to[0].email, "max@example.com");

    assert_eq!(w.sdk.mark_read(key.clone()).await.unwrap().marked, 1);
    assert_eq!(
        w.sdk
            .conversations(None, None, None, None)
            .await
            .unwrap()
            .unread_people,
        0
    );
    let original = w.sdk.message(chat.messages[2].id).await.unwrap();
    assert_eq!(
        (original.folder.as_str(), original.outgoing),
        ("INBOX", false)
    );
}

#[tokio::test]
async fn templates_preview_and_send() {
    let w = world(true).await;
    let list = w.sdk.templates().await.unwrap();
    assert!(list.templates.len() >= 4 && list.placeholders.iter().any(|p| p.name == "first_name"));

    let made = w
        .sdk
        .create_template(Template {
            id: 0,
            kind: TemplateKind::Greeting,
            name: "Max".into(),
            text: "Lieber {first_name},".into(),
            fallback: None,
            audience: vec!["max@example.com".into()],
            is_default: false,
        })
        .await
        .unwrap();
    assert!(made.id > 0);
    let renamed = w
        .sdk
        .update_template(Template {
            name: "Freunde".into(),
            ..made.clone()
        })
        .await
        .unwrap();
    assert_eq!(renamed.name, "Freunde");

    let p = w
        .sdk
        .preview(PreviewRequest {
            to: vec!["Max Müller <max@example.com>".into()],
            body: "Kommst du?".into(),
            greeting: Choice::Auto,
            closing: Choice::Auto,
        })
        .await
        .unwrap();
    assert_eq!(p.text, "Lieber Max,\n\nKommst du?\n\nVG\nPaul");
    assert_eq!(p.greeting.unwrap().name, "Freunde");
    let none = w
        .sdk
        .preview(PreviewRequest {
            to: vec!["max@example.com".into()],
            body: "Hi".into(),
            greeting: Choice::None,
            closing: Choice::Id {
                id: list
                    .templates
                    .iter()
                    .find(|t| t.kind == TemplateKind::Closing && t.name == "Formal")
                    .unwrap()
                    .id,
            },
        })
        .await
        .unwrap();
    assert_eq!(none.text, "Hi\n\nMit freundlichen Grüßen\nPaul Meier");

    let sent = w
        .sdk
        .send(SendRequest {
            to: vec!["Max Müller <max@example.com>".into()],
            cc: vec![],
            bcc: vec!["boss@example.org".into()],
            subject: "Fußball".into(),
            body: "Kommst du?".into(),
            greeting: Choice::Auto,
            closing: Choice::Auto,
            reply_to: None,
        })
        .await
        .unwrap();
    assert_eq!(sent.text, "Lieber Max,\n\nKommst du?\n\nVG\nPaul");
    assert_eq!(
        w.sender.sent()[0].recipients,
        ["max@example.com", "boss@example.org"]
    );

    w.sdk.delete_template(made.id).await.unwrap();
    assert!(w
        .sdk
        .templates()
        .await
        .unwrap()
        .templates
        .iter()
        .all(|t| t.id != made.id));
}

#[tokio::test]
async fn the_calendar() {
    let w = world(true).await;
    let e = w
        .sdk
        .create_event(NewEvent {
            title: "Zahnarzt".into(),
            start: "2026-11-12T08:30".into(),
            end: Some("2026-11-12T09:15".into()),
            all_day: false,
            location: Some("Praxis".into()),
            description: None,
        })
        .await
        .unwrap();
    assert_eq!(
        (e.source.as_str(), e.location.as_deref()),
        ("manual", Some("Praxis"))
    );
    let list = w
        .sdk
        .events(Some("2026-11-01".into()), Some("2026-11-30".into()), false)
        .await
        .unwrap();
    assert_eq!(list.events.len(), 1);

    w.sdk.remove_event(e.id).await.unwrap();
    assert!(w
        .sdk
        .events(Some("2026-11-01".into()), Some("2026-11-30".into()), false)
        .await
        .unwrap()
        .events
        .is_empty());
    let back = w.sdk.restore_event(e.id).await.unwrap();
    assert_eq!(back.title, "Zahnarzt");
    assert_eq!(
        w.sdk.events(None, None, true).await.unwrap().events.len(),
        1,
        "the default window is the next 90 days"
    );
}

#[tokio::test]
async fn the_servers_reasons_come_back_as_errors() {
    let w = world(false).await;
    match w.sdk.sync().await.unwrap_err() {
        SdkError::Api {
            status, message, ..
        } => assert_eq!((status, message.contains("No mailbox")), (503, true)),
        other => panic!("{other:?}"),
    }
    match w
        .sdk
        .create_template(Template {
            id: 0,
            kind: TemplateKind::Greeting,
            name: "".into(),
            text: "Hallo {vorname}".into(),
            fallback: None,
            audience: vec!["kaputt".into()],
            is_default: false,
        })
        .await
        .unwrap_err()
    {
        SdkError::Api {
            status, problems, ..
        } => assert_eq!((status, problems.len() >= 3), (400, true), "{problems:?}"),
        other => panic!("{other:?}"),
    }
    assert!(matches!(
        w.sdk
            .conversation("p-000000000000".into())
            .await
            .unwrap_err(),
        SdkError::Api { status: 404, .. }
    ));
    assert!(matches!(
        w.sdk.remove_event(999).await.unwrap_err(),
        SdkError::Api { status: 404, .. }
    ));
    let w = world(true).await;
    assert!(matches!(
        w.sdk
            .send(SendRequest {
                to: vec!["not an address".into()],
                cc: vec![],
                bcc: vec![],
                subject: "x".into(),
                body: "y".into(),
                greeting: Choice::None,
                closing: Choice::None,
                reply_to: None
            })
            .await
            .unwrap_err(),
        SdkError::Api { status: 400, .. }
    ));
}

#[tokio::test]
async fn a_server_that_is_not_there_or_not_ours() {
    struct Down;
    #[async_trait]
    impl Transport for Down {
        async fn send(&self, _: Request) -> Result<Response, SdkError> {
            Err(SdkError::Network {
                message: "connection refused".into(),
            })
        }
    }
    assert_eq!(
        MailSdk::with_transport(Arc::new(Down))
            .info()
            .await
            .unwrap_err(),
        SdkError::Network {
            message: "connection refused".into()
        }
    );

    struct Html(u16, &'static str);
    #[async_trait]
    impl Transport for Html {
        async fn send(&self, _: Request) -> Result<Response, SdkError> {
            Ok(Response {
                status: self.0,
                body: self.1.as_bytes().to_vec(),
            })
        }
    }
    assert!(matches!(
        MailSdk::with_transport(Arc::new(Html(200, "<html>")))
            .info()
            .await
            .unwrap_err(),
        SdkError::Decode { .. }
    ));
    match MailSdk::with_transport(Arc::new(Html(401, "")))
        .info()
        .await
        .unwrap_err()
    {
        SdkError::Api {
            status: 401,
            message,
            ..
        } => assert!(message.contains("token")),
        other => panic!("{other:?}"),
    }
    match MailSdk::with_transport(Arc::new(Html(404, "")))
        .info()
        .await
        .unwrap_err()
    {
        SdkError::Api {
            status: 404,
            message,
            ..
        } => assert!(message.contains("older build")),
        other => panic!("{other:?}"),
    }
}

#[cfg(feature = "http")]
#[tokio::test]
async fn over_real_http_with_the_token() {
    use axum::routing::get;
    // a real socket, so the HTTP transport itself is exercised: it must send the bearer token
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let app = Router::new().route(
        "/v1/mail/info",
        get(|headers: axum::http::HeaderMap| async move {
            if headers.get("authorization").and_then(|v| v.to_str().ok()) == Some("Bearer secret-token-12345") {
                axum::response::IntoResponse::into_response(axum::Json(serde_json::json!({
                    "configured": true, "address": null, "timezone": "Europe/Berlin", "poll_minutes": 5, "messages": 7, "unread": 2, "syncing": false, "last_sync": null
                })))
            } else {
                axum::response::IntoResponse::into_response((axum::http::StatusCode::UNAUTHORIZED, ""))
            }
        }),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let ok = MailSdk::new(
        format!("http://127.0.0.1:{port}/"),
        "secret-token-12345".into(),
    );
    assert_eq!(ok.info().await.unwrap().messages, 7);
    let wrong = MailSdk::new(
        format!("http://127.0.0.1:{port}"),
        "wrong-token-12345".into(),
    );
    assert!(matches!(
        wrong.info().await.unwrap_err(),
        SdkError::Api { status: 401, .. }
    ));
    let nobody = MailSdk::new("http://127.0.0.1:9".into(), "secret-token-12345".into());
    match nobody.info().await.unwrap_err() {
        SdkError::Network { message } => assert!(!message.contains("secret-token-12345")),
        other => panic!("{other:?}"),
    }
}
