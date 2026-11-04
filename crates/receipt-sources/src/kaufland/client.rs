//! Typed client for the Kaufland account server and the receipt API. All HTTP goes through the
//! same seam as the Lidl Plus source ([`LidlHttp`]); nothing here opens a connection by itself.

use std::sync::Arc;
use std::time::Duration;

use serde_json::Value;
use url::Url;

use crate::config::KauflandCardConfig;
use crate::lidl::pkce::Pkce;
use crate::lidl::{HttpRequest, LidlHttp, Method, Tokens};

use super::{consts, KauflandError};

/// Pages of the receipt list read at most (a safety net against a server that never ends).
pub const MAX_PAGES: usize = 40;

/// The addresses and identifiers in use: the constants, overridden from the configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Endpoints {
    pub client_id: String,
    pub loyalty_client_id: String,
    pub authorize_url: String,
    pub token_url: String,
    pub userinfo_url: String,
    /// Without trailing slash.
    pub api_url: String,
    pub redirect_uri: String,
    pub country: String,
    pub language: String,
    pub app_version: String,
}

impl Endpoints {
    pub fn from_config(c: &KauflandCardConfig) -> Self {
        let pick = |o: &Option<String>, d: String| {
            o.as_ref()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or(d)
        };
        Endpoints {
            client_id: pick(&c.client_id, consts::CLIENT_ID.into()),
            loyalty_client_id: pick(&c.loyalty_client_id, consts::LOYALTY_CLIENT_ID.into()),
            authorize_url: pick(
                &c.authorize_url,
                format!("{}{}", consts::AUTH_BASE, consts::AUTHORIZE_PATH),
            ),
            token_url: pick(
                &c.token_url,
                format!("{}{}", consts::AUTH_BASE, consts::TOKEN_PATH),
            ),
            userinfo_url: pick(
                &c.userinfo_url,
                format!("{}{}", consts::AUTH_BASE, consts::USERINFO_PATH),
            ),
            api_url: pick(&c.api_url, consts::API_BASE.into())
                .trim_end_matches('/')
                .to_string(),
            redirect_uri: pick(&c.redirect_uri, consts::REDIRECT_URI.into()),
            country: c.country.trim().to_uppercase(),
            language: c.language.trim().to_lowercase(),
            app_version: pick(&c.app_version, consts::APP_VERSION.into()),
        }
    }

    /// Scheme of the redirect address, which the mobile app watches for.
    pub fn callback_scheme(&self) -> String {
        self.redirect_uri
            .split_once("://")
            .map_or(consts::CALLBACK_SCHEME, |(s, _)| s)
            .to_string()
    }

    /// The address the user opens in a browser to sign in on Kaufland's own page.
    pub fn authorize_address(&self, pkce: &Pkce) -> Result<String, KauflandError> {
        let mut url = Url::parse(&self.authorize_url).map_err(|_| {
            KauflandError::Config("the authorize address is not a valid URL".into())
        })?;
        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &self.redirect_uri)
            .append_pair("ui_locales", &format!("{}-{}", self.language, self.country))
            .append_pair("v", consts::OAUTH_VERSION)
            .append_pair("code_challenge", &pkce.challenge())
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &pkce.state);
        Ok(url.into())
    }
}

pub struct KauflandClient {
    http: Arc<dyn LidlHttp>,
    pub endpoints: Endpoints,
    /// Pause between requests to the receipt API.
    gap: Duration,
}

impl KauflandClient {
    pub fn new(http: Arc<dyn LidlHttp>, endpoints: Endpoints, gap: Duration) -> Self {
        KauflandClient {
            http,
            endpoints,
            gap,
        }
    }

    async fn token_request(
        &self,
        mut form: Vec<(String, String)>,
        refresh: bool,
    ) -> Result<Tokens, KauflandError> {
        form.push(("client_id".into(), self.endpoints.client_id.clone()));
        form.push(("v".into(), consts::OAUTH_VERSION.into()));
        let res = self
            .http
            .send(HttpRequest {
                method: Method::Post,
                url: self.endpoints.token_url.clone(),
                headers: vec![("Accept".into(), "application/json".into())],
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
                        KauflandError::NeedsSignIn
                    } else {
                        KauflandError::SignInRefused(
                            "Kaufland did not accept the sign-in (the code may have expired); start again"
                                .into(),
                        )
                    }
                }
                (s, _) => KauflandError::Status(s),
            });
        }
        let v: Value = serde_json::from_str(&res.body)
            .map_err(|_| KauflandError::BadResponse("the token answer is not JSON".into()))?;
        let access_token = v
            .get("access_token")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                KauflandError::BadResponse("the token answer has no access_token".into())
            })?
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
    pub async fn exchange_code(&self, code: &str, verifier: &str) -> Result<Tokens, KauflandError> {
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
    pub async fn refresh(&self, refresh_token: &str) -> Result<Tokens, KauflandError> {
        self.token_request(
            vec![
                ("grant_type".into(), "refresh_token".into()),
                ("refresh_token".into(), refresh_token.into()),
            ],
            true,
        )
        .await
    }

    async fn get_json(
        &self,
        url: String,
        headers: Vec<(String, String)>,
    ) -> Result<Option<Value>, KauflandError> {
        let res = self
            .http
            .send(HttpRequest {
                method: Method::Get,
                url,
                headers,
                form: Vec::new(),
            })
            .await?;
        match res.status {
            204 => Ok(None),
            200..=299 => serde_json::from_str(&res.body)
                .map(Some)
                .map_err(|_| KauflandError::BadResponse("the answer is not JSON".into())),
            401 => Err(KauflandError::NeedsSignIn),
            s => Err(KauflandError::Status(s)),
        }
    }

    /// The Kaufland customer id of the signed-in account, which the receipt API wants in its path.
    pub async fn user_id(&self, access_token: &str) -> Result<String, KauflandError> {
        let v = self
            .get_json(
                self.endpoints.userinfo_url.clone(),
                vec![
                    ("Authorization".into(), format!("Bearer {access_token}")),
                    ("Accept".into(), "application/json".into()),
                ],
            )
            .await?
            .ok_or_else(|| KauflandError::BadResponse("no account information".into()))?;
        let candidates = [
            v.get("user_id"),
            v.get("userId"),
            v.get("user").and_then(|u| u.get("user_id")),
            v.get("user").and_then(|u| u.get("userId")),
            v.get("sub"),
        ];
        let id = candidates
            .into_iter()
            .flatten()
            .find_map(|c| match c {
                Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
            .ok_or_else(|| KauflandError::BadResponse("the account has no user id".into()))?;
        // goes into a path: keep it to what an id contains
        if !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        {
            return Err(KauflandError::BadResponse(
                "the user id has odd characters".into(),
            ));
        }
        Ok(id)
    }

    /// One page of receipts (`page` counts from 0), newest first as the server orders them. An
    /// empty list means there are no more.
    pub async fn transactions_page(
        &self,
        access_token: &str,
        user_id: &str,
        page: usize,
    ) -> Result<Vec<Value>, KauflandError> {
        if page > 0 {
            tokio::time::sleep(self.gap).await;
        }
        let url = format!(
            "{}/api/v2/customers/{user_id}/transactions?start={}&limit={}&country={}&version=2",
            self.endpoints.api_url,
            page * consts::PAGE_SIZE,
            consts::PAGE_SIZE,
            self.endpoints.country
        );
        let headers = vec![
            ("Accept".into(), "application/json".into()),
            ("Authorization".into(), format!("Bearer {access_token}")),
            ("client-id".into(), self.endpoints.loyalty_client_id.clone()),
            ("app-platform".into(), consts::APP_PLATFORM.into()),
            ("app-version".into(), self.endpoints.app_version.clone()),
        ];
        let Some(v) = self.get_json(url, headers).await? else {
            return Ok(Vec::new());
        };
        Ok(extract_list(&v))
    }
}

/// The list of receipts out of an answer that is either the list itself or an object wrapping
/// it under one of a few names.
fn extract_list(v: &Value) -> Vec<Value> {
    if let Some(a) = v.as_array() {
        return a.clone();
    }
    for key in ["transactions", "items", "receipts", "results", "data"] {
        match v.get(key) {
            Some(Value::Array(a)) => return a.clone(),
            Some(inner @ Value::Object(_)) => {
                let list = extract_list(inner);
                if !list.is_empty() {
                    return list;
                }
            }
            _ => {}
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{kaufland_fixtures as fx, FakeLidlHttp};

    fn client(http: &Arc<FakeLidlHttp>) -> KauflandClient {
        KauflandClient::new(
            http.clone(),
            Endpoints::from_config(&KauflandCardConfig::default()),
            Duration::ZERO,
        )
    }

    #[test]
    fn the_sign_in_address_carries_pkce_and_the_apps_parameters() {
        let ep = Endpoints::from_config(&KauflandCardConfig::default());
        let pkce = Pkce::generate().unwrap();
        let url = Url::parse(&ep.authorize_address(&pkce).unwrap()).unwrap();
        assert_eq!(url.host_str(), Some("account.kaufland.com"));
        assert_eq!(url.path(), "/authz-srv/authz");
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], consts::CLIENT_ID);
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["redirect_uri"], consts::REDIRECT_URI);
        assert_eq!(q["ui_locales"], "de-DE");
        assert_eq!(q["v"], consts::OAUTH_VERSION);
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], pkce.challenge());
        assert_eq!(q["state"], pkce.state);
        assert_eq!(ep.callback_scheme(), "com.kaufland.kaufland");
    }

    #[tokio::test]
    async fn code_exchange_sends_the_verifier_and_the_client_id_without_a_secret() {
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(Method::Post, "/token-srv/token", 200, fx::TOKEN);
        let t = client(&http)
            .exchange_code("CODE123", "the-verifier")
            .await
            .unwrap();
        assert_eq!(t.access_token, "fixture-kaufland-access-1");
        assert_eq!(
            t.refresh_token.as_deref(),
            Some("fixture-kaufland-refresh-1")
        );
        let req = &http.requests()[0];
        let form: std::collections::HashMap<_, _> = req.form.iter().cloned().collect();
        assert_eq!(form["grant_type"], "authorization_code");
        assert_eq!(form["code"], "CODE123");
        assert_eq!(form["code_verifier"], "the-verifier");
        assert_eq!(form["client_id"], consts::CLIENT_ID);
        assert_eq!(form["v"], consts::OAUTH_VERSION);
        assert!(!req.headers.iter().any(|(k, _)| k == "Authorization"));
    }

    #[tokio::test]
    async fn a_refused_refresh_means_sign_in_again_and_a_refused_code_is_a_plain_message() {
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(
            Method::Post,
            "/token-srv/token",
            400,
            fx::TOKEN_INVALID_GRANT,
        );
        let c = client(&http);
        assert_eq!(
            c.refresh("old").await.unwrap_err(),
            KauflandError::NeedsSignIn
        );
        assert!(matches!(
            c.exchange_code("c", "v").await.unwrap_err(),
            KauflandError::SignInRefused(_)
        ));
    }

    #[tokio::test]
    async fn the_user_id_is_found_under_any_of_its_usual_names() {
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(Method::Get, "/users-srv/userinfo", 200, fx::USERINFO);
        assert_eq!(client(&http).user_id("tok").await.unwrap(), "user-4711");
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(
            Method::Get,
            "/users-srv/userinfo",
            200,
            r#"{"user":{"userId":99}}"#,
        );
        assert_eq!(client(&http).user_id("tok").await.unwrap(), "99");
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(Method::Get, "/users-srv/userinfo", 200, r#"{"sub":"../x"}"#);
        assert!(client(&http).user_id("tok").await.is_err());
    }

    #[tokio::test]
    async fn receipts_are_asked_for_the_way_the_app_does() {
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(Method::Get, "start=0&", 200, fx::TRANSACTIONS_PAGE_1);
        http.respond(Method::Get, "start=20&", 204, "");
        let c = client(&http);
        let page = c.transactions_page("tok", "user-4711", 0).await.unwrap();
        assert_eq!(page.len(), 2);
        assert!(c
            .transactions_page("tok", "user-4711", 1)
            .await
            .unwrap()
            .is_empty());
        let req = &http.requests()[0];
        assert!(req.url.starts_with(
            "https://p.crm-dynamics.schwarz/api/v2/customers/user-4711/transactions?"
        ));
        assert!(
            req.url.contains("limit=20")
                && req.url.contains("country=DE")
                && req.url.contains("version=2")
        );
        let h: std::collections::HashMap<_, _> = req.headers.iter().cloned().collect();
        assert_eq!(h["Authorization"], "Bearer tok");
        assert_eq!(h["client-id"], consts::LOYALTY_CLIENT_ID);
        assert_eq!(h["app-platform"], "Android");
        assert_eq!(h["app-version"], consts::APP_VERSION);
    }

    #[tokio::test]
    async fn a_401_means_sign_in_again_and_other_codes_are_reported() {
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(Method::Get, "start=0&", 401, "");
        assert_eq!(
            client(&http)
                .transactions_page("t", "u", 0)
                .await
                .unwrap_err(),
            KauflandError::NeedsSignIn
        );
        let http = Arc::new(FakeLidlHttp::default());
        http.respond(Method::Get, "start=0&", 403, "");
        assert_eq!(
            client(&http)
                .transactions_page("t", "u", 0)
                .await
                .unwrap_err(),
            KauflandError::Status(403)
        );
    }

    #[test]
    fn the_list_is_found_in_a_bare_array_or_under_a_wrapper() {
        assert_eq!(extract_list(&serde_json::json!([{"id":1}])).len(), 1);
        assert_eq!(
            extract_list(&serde_json::json!({"transactions":[{"id":1},{"id":2}]})).len(),
            2
        );
        assert_eq!(
            extract_list(&serde_json::json!({"data":{"items":[{"id":1}]}})).len(),
            1
        );
        assert!(extract_list(&serde_json::json!({"nope":1})).is_empty());
    }
}
