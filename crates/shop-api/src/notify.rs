//! Telling the person about a deal when the app is not open: ntfy, Expo push (for the app) or a
//! plain webhook. The app can also just poll `/notifications`; these are the extra route for a
//! server that runs all the time.

use std::sync::Arc;

use async_trait::async_trait;
use financer_shop_store::StoredEvent;
use serde_json::json;

/// What a notifier learned while sending.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    /// Push tokens the service says no longer exist; the caller removes them.
    pub dead_tokens: Vec<String>,
}

#[async_trait]
pub trait Notifier: Send + Sync {
    fn name(&self) -> &str;
    async fn send(&self, events: &[StoredEvent], push_tokens: &[String])
        -> Result<Outcome, String>;
}

/// The HTTP POST the notifiers need. A trait so tests never touch the network.
#[async_trait]
pub trait Poster: Send + Sync {
    /// Returns the status and body.
    async fn post(
        &self,
        url: &str,
        headers: &[(String, String)],
        body: String,
    ) -> Result<(u16, String), String>;
}

pub struct ReqwestPoster {
    client: reqwest::Client,
}

impl ReqwestPoster {
    pub fn new() -> Result<ReqwestPoster, String> {
        let client = reqwest::Client::builder()
            .user_agent("financer-shop/0.1")
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(ReqwestPoster { client })
    }
}

#[async_trait]
impl Poster for ReqwestPoster {
    async fn post(
        &self,
        url: &str,
        headers: &[(String, String)],
        body: String,
    ) -> Result<(u16, String), String> {
        let mut req = self.client.post(url).body(body);
        for (k, v) in headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let res = req.send().await.map_err(|e| e.to_string())?;
        let status = res.status().as_u16();
        Ok((status, res.text().await.unwrap_or_default()))
    }
}

fn price(cents: i64) -> String {
    format!("{},{:02} EUR", cents / 100, cents % 100)
}

/// <https://ntfy.sh> (or a self-hosted ntfy): one message per deal to a topic URL.
pub struct NtfyNotifier {
    pub poster: Arc<dyn Poster>,
    pub topic_url: String,
    pub token: Option<String>,
}

#[async_trait]
impl Notifier for NtfyNotifier {
    fn name(&self) -> &str {
        "ntfy"
    }

    async fn send(&self, events: &[StoredEvent], _tokens: &[String]) -> Result<Outcome, String> {
        for e in events {
            let ev = &e.event;
            let mut headers = vec![
                // ntfy headers are plain ASCII
                ("Title".to_string(), ascii(&format!("Deal: {}", ev.title))),
                ("Tags".to_string(), "moneybag".to_string()),
            ];
            if ev.url.starts_with("http") {
                headers.push(("Click".to_string(), ev.url.clone()));
            }
            if let Some(t) = &self.token {
                headers.push(("Authorization".to_string(), format!("Bearer {t}")));
            }
            let (status, body) = self
                .poster
                .post(&self.topic_url, &headers, ev.message())
                .await?;
            if status >= 300 {
                return Err(format!("ntfy answered {status}: {body}"));
            }
        }
        Ok(Outcome::default())
    }
}

fn ascii(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii() && !c.is_control() {
                c
            } else {
                '?'
            }
        })
        .collect()
}

/// The Expo push service, for the app's own push tokens.
pub struct ExpoNotifier {
    pub poster: Arc<dyn Poster>,
    pub endpoint: String,
}

impl ExpoNotifier {
    pub const ENDPOINT: &'static str = "https://exp.host/--/api/v2/push/send";
}

#[async_trait]
impl Notifier for ExpoNotifier {
    fn name(&self) -> &str {
        "expo"
    }

    async fn send(&self, events: &[StoredEvent], tokens: &[String]) -> Result<Outcome, String> {
        if tokens.is_empty() {
            return Ok(Outcome::default());
        }
        let mut messages = Vec::new();
        let mut owners = Vec::new();
        for e in events {
            for t in tokens {
                messages.push(json!({
                    "to": t,
                    "title": format!("Deal: {}", e.event.title),
                    "body": e.event.message(),
                    "data": { "type": "deal", "eventId": e.id, "productId": e.event.product_id, "url": e.event.url, "price": price(e.event.price_cents) },
                    "sound": "default",
                    "channelId": "deals",
                }));
                owners.push(t.clone());
            }
        }
        // the service takes at most 100 messages per request
        let mut dead = Vec::new();
        for (chunk, who) in messages.chunks(100).zip(owners.chunks(100)) {
            let body = serde_json::to_string(chunk).map_err(|e| e.to_string())?;
            let headers = vec![("Content-Type".to_string(), "application/json".to_string())];
            let (status, text) = self.poster.post(&self.endpoint, &headers, body).await?;
            if status >= 300 {
                return Err(format!("Expo push answered {status}: {text}"));
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(items) = v.get("data").and_then(|d| d.as_array()) {
                    for (item, token) in items.iter().zip(who) {
                        let err = item.pointer("/details/error").and_then(|e| e.as_str());
                        if err == Some("DeviceNotRegistered") && !dead.contains(token) {
                            dead.push(token.clone());
                        }
                    }
                }
            }
        }
        Ok(Outcome { dead_tokens: dead })
    }
}

/// Any URL that takes JSON: `{"events": [...]}`.
pub struct WebhookNotifier {
    pub poster: Arc<dyn Poster>,
    pub url: String,
    /// Sent as `Authorization: Bearer <secret>` when set.
    pub secret: Option<String>,
}

#[async_trait]
impl Notifier for WebhookNotifier {
    fn name(&self) -> &str {
        "webhook"
    }

    async fn send(&self, events: &[StoredEvent], _tokens: &[String]) -> Result<Outcome, String> {
        let body = json!({ "events": events.iter().map(|e| json!({
            "id": e.id,
            "message": e.event.message(),
            "event": e.event,
        })).collect::<Vec<_>>() });
        let mut headers = vec![("Content-Type".to_string(), "application/json".to_string())];
        if let Some(s) = &self.secret {
            headers.push(("Authorization".to_string(), format!("Bearer {s}")));
        }
        let (status, text) = self
            .poster
            .post(&self.url, &headers, body.to_string())
            .await?;
        if status >= 300 {
            return Err(format!("webhook answered {status}: {text}"));
        }
        Ok(Outcome::default())
    }
}

/// A poster that records requests and answers from a script; for tests here and elsewhere.
pub mod testing {
    use super::*;
    use std::sync::Mutex;

    /// URL, headers and body of one request.
    pub type Request = (String, Vec<(String, String)>, String);

    #[derive(Default)]
    pub struct FakePoster {
        pub requests: Mutex<Vec<Request>>,
        pub answers: Mutex<Vec<(u16, String)>>,
    }

    impl FakePoster {
        pub fn answering(answers: Vec<(u16, &str)>) -> FakePoster {
            FakePoster {
                requests: Mutex::default(),
                answers: Mutex::new(
                    answers
                        .into_iter()
                        .rev()
                        .map(|(s, b)| (s, b.to_string()))
                        .collect(),
                ),
            }
        }
    }

    #[async_trait]
    impl Poster for FakePoster {
        async fn post(
            &self,
            url: &str,
            headers: &[(String, String)],
            body: String,
        ) -> Result<(u16, String), String> {
            self.requests
                .lock()
                .unwrap()
                .push((url.to_string(), headers.to_vec(), body));
            Ok(self
                .answers
                .lock()
                .unwrap()
                .pop()
                .unwrap_or((200, "{}".into())))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::FakePoster;
    use super::*;
    use financer_shop_core::{DealEvent, EventKind, Verdict};

    fn stored(id: i64, title: &str) -> StoredEvent {
        StoredEvent {
            id,
            event: DealEvent {
                key: format!("k{id}"),
                watch_id: 1,
                watch_name: "w".into(),
                product_id: "p".into(),
                title: title.into(),
                shop: "Shop".into(),
                url: "https://shop.test/p".into(),
                price_cents: 54_900,
                reference_cents: Some(64_900),
                discount_pct: 15.4,
                verdict: Verdict::Good,
                kind: EventKind::Deal,
            },
            created_at: 0,
            delivered_at: None,
            read_at: None,
        }
    }

    #[tokio::test]
    async fn ntfy_sends_one_message_per_deal_with_a_click_target() {
        let poster = Arc::new(FakePoster::default());
        let n = NtfyNotifier {
            poster: poster.clone(),
            topic_url: "https://ntfy.sh/my-deals".into(),
            token: Some("tk".into()),
        };
        n.send(&[stored(1, "Pixel 9 – 128 GB"), stored(2, "Pixel 8")], &[])
            .await
            .unwrap();
        let reqs = poster.requests.lock().unwrap();
        assert_eq!(reqs.len(), 2);
        assert_eq!(reqs[0].2, "Pixel 9 – 128 GB is 549,00 EUR at Shop (-15 %)");
        let h = |k: &str| {
            reqs[0]
                .1
                .iter()
                .find(|(n, _)| n == k)
                .map(|(_, v)| v.clone())
        };
        assert_eq!(h("Click").as_deref(), Some("https://shop.test/p"));
        assert_eq!(h("Authorization").as_deref(), Some("Bearer tk"));
        assert_eq!(h("Title").as_deref(), Some("Deal: Pixel 9 ? 128 GB"));
    }

    #[tokio::test]
    async fn a_refusing_service_is_an_error() {
        let poster = Arc::new(FakePoster::answering(vec![(403, "no")]));
        let n = NtfyNotifier {
            poster,
            topic_url: "u".into(),
            token: None,
        };
        assert!(n
            .send(&[stored(1, "x")], &[])
            .await
            .unwrap_err()
            .contains("403"));
    }

    #[tokio::test]
    async fn expo_pushes_to_every_token_and_reports_dead_ones() {
        let answer = r#"{"data":[{"status":"ok"},{"status":"error","details":{"error":"DeviceNotRegistered"}}]}"#;
        let poster = Arc::new(FakePoster::answering(vec![(200, answer)]));
        let n = ExpoNotifier {
            poster: poster.clone(),
            endpoint: ExpoNotifier::ENDPOINT.into(),
        };
        let out = n
            .send(
                &[stored(7, "Pixel 9")],
                &["ExponentPushToken[a]".into(), "ExponentPushToken[b]".into()],
            )
            .await
            .unwrap();
        assert_eq!(out.dead_tokens, ["ExponentPushToken[b]"]);
        let body: serde_json::Value =
            serde_json::from_str(&poster.requests.lock().unwrap()[0].2).unwrap();
        assert_eq!(body.as_array().unwrap().len(), 2);
        assert_eq!(body[0]["to"], "ExponentPushToken[a]");
        assert_eq!(body[0]["data"]["eventId"], 7);
        // nothing to do without tokens
        assert_eq!(
            n.send(&[stored(7, "x")], &[]).await.unwrap(),
            Outcome::default()
        );
        assert_eq!(poster.requests.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn the_webhook_gets_all_events_in_one_json_post() {
        let poster = Arc::new(FakePoster::default());
        let n = WebhookNotifier {
            poster: poster.clone(),
            url: "https://hook.test/x".into(),
            secret: Some("s".into()),
        };
        n.send(&[stored(1, "A"), stored(2, "B")], &[])
            .await
            .unwrap();
        let reqs = poster.requests.lock().unwrap();
        assert_eq!(reqs.len(), 1);
        let body: serde_json::Value = serde_json::from_str(&reqs[0].2).unwrap();
        assert_eq!(body["events"].as_array().unwrap().len(), 2);
        assert_eq!(
            body["events"][1]["message"],
            "B is 549,00 EUR at Shop (-15 %)"
        );
    }
}
