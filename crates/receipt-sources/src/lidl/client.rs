//! Typed client for the Lidl Plus identity server and ticket API. All HTTP goes through
//! [`LidlHttp`]; nothing here opens a connection by itself.

use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::Value;

use crate::config::LidlPlusConfig;

use super::consts;
use super::http::{HttpRequest, HttpResponse, LidlHttp, Method};
use super::ticket::{Ticket, TicketSummary};
use super::LidlError;

/// Pages of the ticket list read at most (a safety net against a server that never ends).
const MAX_PAGES: u32 = 40;

/// The addresses and identifiers in use: the constants, overridden from the configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    pub client_id: String,
    pub authorize_url: String,
    pub token_url: String,
    /// Without country and trailing slash.
    pub tickets_url: String,
    pub redirect_uri: String,
    pub scope: String,
    pub country: String,
    pub language: String,
}

impl Endpoints {
    pub fn from_config(c: &LidlPlusConfig) -> Self {
        let pick = |o: &Option<String>, d: String| {
            o.as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or(d)
        };
        Endpoints {
            client_id: pick(&c.client_id, consts::CLIENT_ID.into()),
            authorize_url: pick(
                &c.authorize_url,
                format!("{}{}", consts::AUTH_BASE, consts::AUTHORIZE_PATH),
            ),
            token_url: pick(
                &c.token_url,
                format!("{}{}", consts::AUTH_BASE, consts::TOKEN_PATH),
            ),
            tickets_url: pick(&c.tickets_url, consts::TICKETS_BASE.into())
                .trim_end_matches('/')
                .to_string(),
            redirect_uri: pick(&c.redirect_uri, consts::REDIRECT_URI.into()),
            scope: pick(&c.scope, consts::SCOPE.into()),
            country: c.country.trim().to_uppercase(),
            language: c.language.trim().to_lowercase(),
        }
    }

    /// Scheme of the redirect address, which the mobile app watches for.
    pub fn callback_scheme(&self) -> String {
        self.redirect_uri
            .split_once("://")
            .map_or(consts::CALLBACK_SCHEME, |(s, _)| s)
            .to_string()
    }
}

/// Tokens from the identity server. Never printed.
#[derive(Clone)]
pub struct Tokens {
    pub access_token: String,
    /// The refresh token to keep; absent when the server did not send a new one.
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

impl std::fmt::Debug for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Tokens")
            .field("expires_in", &self.expires_in)
            .finish_non_exhaustive()
    }
}

pub struct LidlClient {
    http: Arc<dyn LidlHttp>,
    pub endpoints: Endpoints,
    /// Pause between requests to the ticket API.
    gap: Duration,
}

impl LidlClient {
    pub fn new(http: Arc<dyn LidlHttp>, endpoints: Endpoints, gap: Duration) -> Self {
        LidlClient {
            http,
            endpoints,
            gap,
        }
    }

    fn basic_auth(&self) -> String {
        format!(
            "Basic {}",
            STANDARD.encode(format!(
                "{}:{}",
                self.endpoints.client_id,
                consts::CLIENT_SECRET
            ))
        )
    }

    async fn token_request(
        &self,
        form: Vec<(String, String)>,
        refresh: bool,
    ) -> Result<Tokens, LidlError> {
        let res = self
            .http
            .send(HttpRequest {
                method: Method::Post,
                url: self.endpoints.token_url.clone(),
                headers: vec![
                    ("Authorization".into(), self.basic_auth()),
                    ("Accept".into(), "application/json".into()),
                ],
                form,
            })
            .await?;
        if res.status >= 400 {
            let error = serde_json::from_str::<Value>(&res.body)
                .ok()
                .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string));
            return Err(match (res.status, error.as_deref()) {
                (_, Some("invalid_grant" | "invalid_token" | "unauthorized_client")) | (401, _) => {
                    if refresh {
                        LidlError::NeedsSignIn
                    } else {
                        LidlError::SignInRefused(
                            "Lidl did not accept the sign-in (the code may have expired); start again"
                                .into(),
                        )
                    }
                }
                (s, _) => LidlError::Status(s),
            });
        }
        let v: Value = serde_json::from_str(&res.body)
            .map_err(|_| LidlError::BadResponse("the token answer is not JSON".into()))?;
        let access_token = v
            .get("access_token")
            .and_then(Value::as_str)
            .ok_or_else(|| LidlError::BadResponse("the token answer has no access_token".into()))?
            .to_string();
        Ok(Tokens {
            access_token,
            refresh_token: v
                .get("refresh_token")
                .and_then(Value::as_str)
                .map(str::to_string),
            expires_in: v.get("expires_in").and_then(Value::as_u64).unwrap_or(300),
        })
    }

    /// Trade the one-time code from the sign-in redirect for tokens.
    pub async fn exchange_code(&self, code: &str, verifier: &str) -> Result<Tokens, LidlError> {
        self.token_request(
            vec![
                ("grant_type".into(), "authorization_code".into()),
                ("code".into(), code.into()),
                ("redirect_uri".into(), self.endpoints.redirect_uri.clone()),
                ("code_verifier".into(), verifier.into()),
            ],
            false,
        )
        .await
    }

    /// Get a fresh access token (and possibly a rotated refresh token).
    pub async fn refresh(&self, refresh_token: &str) -> Result<Tokens, LidlError> {
        self.token_request(
            vec![
                ("grant_type".into(), "refresh_token".into()),
                ("refresh_token".into(), refresh_token.into()),
            ],
            true,
        )
        .await
    }

    fn api_headers(&self, access_token: &str) -> Vec<(String, String)> {
        vec![
            ("Authorization".into(), format!("Bearer {access_token}")),
            ("App-Version".into(), consts::APP_VERSION_HEADER.into()),
            (
                "Operating-System".into(),
                consts::OPERATING_SYSTEM_HEADER.into(),
            ),
            ("App".into(), consts::APP_HEADER.into()),
            ("Accept-Language".into(), self.endpoints.language.clone()),
            ("Accept".into(), "application/json".into()),
        ]
    }

    async fn api_get(&self, url: String, access_token: &str) -> Result<Value, LidlError> {
        let res: HttpResponse = self
            .http
            .send(HttpRequest {
                method: Method::Get,
                url,
                headers: self.api_headers(access_token),
                form: Vec::new(),
            })
            .await?;
        match res.status {
            200..=299 => serde_json::from_str(&res.body)
                .map_err(|_| LidlError::BadResponse("the answer is not JSON".into())),
            401 | 403 => Err(LidlError::NeedsSignIn),
            s => Err(LidlError::Status(s)),
        }
    }

    fn tickets_base(&self) -> String {
        format!(
            "{}/{}/tickets",
            self.endpoints.tickets_url, self.endpoints.country
        )
    }

    /// Ids of all tickets, newest first as the server orders them.
    pub async fn list_tickets(&self, access_token: &str) -> Result<Vec<TicketSummary>, LidlError> {
        let mut out: Vec<TicketSummary> = Vec::new();
        for page in 1..=MAX_PAGES {
            if page > 1 {
                tokio::time::sleep(self.gap).await;
            }
            let v = self
                .api_get(
                    format!(
                        "{}?pageNumber={page}&onlyFavorite=False",
                        self.tickets_base()
                    ),
                    access_token,
                )
                .await?;
            let tickets = v.get("tickets").and_then(Value::as_array);
            let Some(tickets) = tickets.filter(|t| !t.is_empty()) else {
                break;
            };
            out.extend(tickets.iter().filter_map(TicketSummary::from_json));
            let total = v.get("totalCount").and_then(Value::as_u64).unwrap_or(0);
            if out.len() as u64 >= total {
                break;
            }
        }
        Ok(out)
    }

    pub async fn ticket(&self, access_token: &str, id: &str) -> Result<Ticket, LidlError> {
        if !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        {
            return Err(LidlError::BadResponse(
                "a ticket id with odd characters".into(),
            ));
        }
        tokio::time::sleep(self.gap).await;
        let v = self
            .api_get(format!("{}/{id}", self.tickets_base()), access_token)
            .await?;
        Ticket::from_json(&v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{lidl_fixtures as fx, FakeLidlHttp};

    fn client(http: &Arc<FakeLidlHttp>) -> LidlClient {
        LidlClient::new(
            http.clone(),
            Endpoints::from_config(&LidlPlusConfig::default()),
            Duration::ZERO,
        )
    }

    #[tokio::test]
    async fn code_exchange_sends_pkce_verifier_and_basic_client_auth() {
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(Method::Post, "/connect/token", 200, fx::TOKEN);
        let t = client(&http)
            .exchange_code("CODE123", "the-verifier")
            .await
            .unwrap();
        assert_eq!(t.access_token, "fixture-access-token-1");
        assert_eq!(t.refresh_token.as_deref(), Some("fixture-refresh-token-1"));
        assert_eq!(t.expires_in, 3600);
        let req = &http.requests()[0];
        assert_eq!(req.url, "https://accounts.lidl.com/connect/token");
        let auth = req
            .headers
            .iter()
            .find(|(k, _)| k == "Authorization")
            .unwrap();
        assert_eq!(
            auth.1,
            format!("Basic {}", STANDARD.encode("LidlPlusNativeClient:secret"))
        );
        let form: std::collections::HashMap<_, _> = req.form.iter().cloned().collect();
        assert_eq!(form["grant_type"], "authorization_code");
        assert_eq!(form["code"], "CODE123");
        assert_eq!(form["code_verifier"], "the-verifier");
        assert_eq!(form["redirect_uri"], "com.lidlplus.app://callback");
        assert!(!format!("{t:?}").contains("fixture-access-token"));
        assert!(!format!("{req:?}").contains("the-verifier"));
    }

    #[tokio::test]
    async fn refresh_uses_the_refresh_grant_and_reports_a_dead_token() {
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(Method::Post, "/connect/token", 200, fx::TOKEN_REFRESHED);
        http.respond(Method::Post, "/connect/token", 400, fx::TOKEN_INVALID_GRANT);
        let c = client(&http);
        let t = c.refresh("old").await.unwrap();
        assert_eq!(t.refresh_token.as_deref(), Some("fixture-refresh-token-2"));
        let form: std::collections::HashMap<_, _> =
            http.requests()[0].form.iter().cloned().collect();
        assert_eq!(
            (form["grant_type"].as_str(), form["refresh_token"].as_str()),
            ("refresh_token", "old")
        );
        assert_eq!(c.refresh("old").await.unwrap_err(), LidlError::NeedsSignIn);
    }

    #[tokio::test]
    async fn a_refused_code_is_a_sign_in_problem_not_a_dead_token() {
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(Method::Post, "/connect/token", 400, fx::TOKEN_INVALID_GRANT);
        let e = client(&http).exchange_code("x", "y").await.unwrap_err();
        assert!(matches!(e, LidlError::SignInRefused(_)), "{e:?}");
        http.respond(Method::Post, "/connect/token", 503, "oops");
        assert_eq!(
            client(&http).exchange_code("x", "y").await.unwrap_err(),
            LidlError::Status(503)
        );
    }

    #[tokio::test]
    async fn ticket_list_follows_pages_and_sends_the_app_headers() {
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(Method::Get, "pageNumber=1", 200, fx::TICKETS_PAGE_1);
        http.respond(Method::Get, "pageNumber=2", 200, fx::TICKETS_PAGE_2);
        let ids: Vec<_> = client(&http)
            .list_tickets("ACCESS")
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(
            ids,
            vec![
                "FIXTURE-TICKET-0001",
                "FIXTURE-TICKET-0002",
                "FIXTURE-TICKET-0003"
            ]
        );
        let reqs = http.requests();
        assert_eq!(reqs.len(), 2);
        assert_eq!(
            reqs[0].url,
            "https://tickets.lidlplus.com/api/v2/DE/tickets?pageNumber=1&onlyFavorite=False"
        );
        let h: std::collections::HashMap<_, _> = reqs[0].headers.iter().cloned().collect();
        assert_eq!(h["Authorization"], "Bearer ACCESS");
        assert_eq!(h["App-Version"], "999.99.9");
        assert_eq!(h["Operating-System"], "iOs");
        assert_eq!(h["App"], "com.lidl.eci.lidl.plus");
        assert_eq!(h["Accept-Language"], "de");
    }

    #[tokio::test]
    async fn single_ticket_and_error_statuses() {
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(
            Method::Get,
            "/tickets/FIXTURE-TICKET-0001",
            200,
            fx::TICKET_1,
        );
        http.respond(Method::Get, "/tickets/DENIED", 401, "");
        http.respond(Method::Get, "/tickets/BROKEN", 200, "<html>");
        let c = client(&http);
        let t = c.ticket("A", "FIXTURE-TICKET-0001").await.unwrap();
        assert_eq!(t.items.len(), 3);
        assert_eq!(
            c.ticket("A", "DENIED").await.unwrap_err(),
            LidlError::NeedsSignIn
        );
        assert!(matches!(
            c.ticket("A", "BROKEN").await.unwrap_err(),
            LidlError::BadResponse(_)
        ));
        // ids come from the server; odd ones never reach a URL
        assert!(matches!(
            c.ticket("A", "../x?y").await.unwrap_err(),
            LidlError::BadResponse(_)
        ));
        assert_eq!(http.requests().len(), 3);
    }

    #[test]
    fn config_overrides_the_constants() {
        let e = Endpoints::from_config(&LidlPlusConfig {
            country: " at ".into(),
            language: "DE".into(),
            client_id: Some("OtherClient".into()),
            tickets_url: Some("https://tickets.example.test/v3/".into()),
            redirect_uri: Some("my.app://done".into()),
            ..Default::default()
        });
        assert_eq!((e.country.as_str(), e.language.as_str()), ("AT", "de"));
        assert_eq!(e.client_id, "OtherClient");
        assert_eq!(e.tickets_url, "https://tickets.example.test/v3");
        assert_eq!(e.callback_scheme(), "my.app");
        assert_eq!(e.token_url, "https://accounts.lidl.com/connect/token");
        assert_eq!(
            Endpoints::from_config(&LidlPlusConfig::default()).callback_scheme(),
            "com.lidlplus.app"
        );
    }
}
