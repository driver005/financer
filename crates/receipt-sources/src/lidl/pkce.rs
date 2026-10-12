//! The browser half of the sign-in: PKCE, the authorization address, and reading the code back
//! out of the address Lidl's page redirects to.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};
use url::Url;

use super::LidlError;

/// RFC 7636 verifier alphabet.
const UNRESERVED: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
const VERIFIER_LEN: usize = 64;

/// A random string from the RFC 7636 alphabet (rejection-free: 66 does not divide 256, so bytes
/// are drawn until they fall in the largest multiple of the alphabet size).
fn random_string(len: usize) -> Result<String, LidlError> {
    let limit = 256 - (256 % UNRESERVED.len());
    let mut out = String::with_capacity(len);
    let mut buf = [0u8; 64];
    while out.len() < len {
        getrandom::fill(&mut buf).map_err(|_| LidlError::Internal("no randomness available".into()))?;
        for b in buf {
            if (b as usize) < limit && out.len() < len {
                out.push(UNRESERVED[b as usize % UNRESERVED.len()] as char);
            }
        }
    }
    Ok(out)
}

/// One started sign-in: what stays on the server until the browser comes back.
#[derive(Clone, PartialEq, Eq)]
pub struct Pkce {
    pub verifier: String,
    pub state: String,
}

impl std::fmt::Debug for Pkce {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pkce")
            .field("state", &self.state)
            .field("verifier", &"<redacted>")
            .finish()
    }
}

impl Pkce {
    pub fn generate() -> Result<Self, LidlError> {
        Ok(Pkce {
            verifier: random_string(VERIFIER_LEN)?,
            state: random_string(32)?,
        })
    }

    /// `BASE64URL(SHA256(verifier))`, method `S256`.
    pub fn challenge(&self) -> String {
        Self::challenge_of(&self.verifier)
    }

    pub fn challenge_of(verifier: &str) -> String {
        URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
    }
}

/// The address the user opens in a browser to sign in on Lidl's own page.
pub struct AuthorizeUrl<'a> {
    pub authorize_endpoint: &'a str,
    pub client_id: &'a str,
    pub redirect_uri: &'a str,
    pub scope: &'a str,
    pub country: &'a str,
    pub language: &'a str,
}

impl AuthorizeUrl<'_> {
    pub fn build(&self, pkce: &Pkce) -> Result<String, LidlError> {
        let mut url = Url::parse(self.authorize_endpoint)
            .map_err(|_| LidlError::Config("the authorize address is not a valid URL".into()))?;
        url.query_pairs_mut()
            .append_pair("client_id", self.client_id)
            .append_pair("response_type", "code")
            .append_pair("scope", self.scope)
            .append_pair("redirect_uri", self.redirect_uri)
            .append_pair("code_challenge", &pkce.challenge())
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &pkce.state)
            // the open-source client appends these two to select the country site
            .append_pair("Country", &self.country.to_uppercase())
            .append_pair(
                "language",
                &format!(
                    "{}-{}",
                    self.language.to_lowercase(),
                    self.country.to_uppercase()
                ),
            );
        Ok(url.into())
    }
}

/// Read the one-time code out of the address the browser ended up on.
///
/// Accepts the full callback address (`com.lidlplus.app://callback?code=...&state=...`), and, for
/// people who copy only part of it, just the query (`?code=...` or `code=...&state=...`). The
/// state is checked when the address carries one. An error reported by Lidl's page is passed on
/// in plain words.
pub fn parse_callback(
    callback: &str,
    expected_state: &str,
    redirect_uri: &str,
) -> Result<String, LidlError> {
    let callback = callback.trim();
    if callback.is_empty() || callback.len() > 4096 {
        return Err(LidlError::BadCallback("the address is empty or far too long".into()));
    }
    let query_text = if callback.contains("://") {
        let url = Url::parse(callback)
            .map_err(|_| LidlError::BadCallback("that is not a web address".into()))?;
        let expected = Url::parse(redirect_uri).ok();
        if let Some(e) = expected {
            if url.scheme() != e.scheme() || url.host_str() != e.host_str() {
                return Err(LidlError::BadCallback(format!(
                    "the address should start with {redirect_uri}"
                )));
            }
        }
        url.query().unwrap_or("").to_string()
    } else {
        callback
            .trim_start_matches(['?', '#'])
            .split_once('?')
            .map_or(callback.trim_start_matches(['?', '#']), |(_, q)| q)
            .to_string()
    };
    let pairs: Vec<(String, String)> = url::form_urlencoded::parse(query_text.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let get = |k: &str| pairs.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str());

    if let Some(err) = get("error") {
        let detail = get("error_description").unwrap_or("");
        return Err(LidlError::SignInRefused(
            format!("{err} {detail}").trim().chars().take(150).collect(),
        ));
    }
    if let Some(state) = get("state") {
        if state != expected_state {
            return Err(LidlError::BadCallback(
                "this address belongs to a different sign-in; start again".into(),
            ));
        }
    }
    let code = get("code").ok_or_else(|| {
        LidlError::BadCallback("the address has no code; copy the whole address".into())
    })?;
    if code.is_empty()
        || code.len() > 512
        || !code
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~'))
    {
        return Err(LidlError::BadCallback("the code in the address looks damaged".into()));
    }
    Ok(code.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lidl::consts::*;

    #[test]
    fn challenge_matches_the_rfc_7636_example() {
        assert_eq!(
            Pkce::challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifiers_and_states_are_long_random_and_url_safe() {
        let a = Pkce::generate().unwrap();
        let b = Pkce::generate().unwrap();
        assert_ne!(a, b);
        assert_eq!(a.verifier.len(), 64);
        assert!(a.verifier.bytes().all(|c| UNRESERVED.contains(&c)));
        assert_eq!(a.state.len(), 32);
        assert!(!format!("{a:?}").contains(&a.verifier));
    }

    fn url() -> AuthorizeUrl<'static> {
        AuthorizeUrl {
            authorize_endpoint: "https://accounts.lidl.com/connect/authorize",
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            scope: SCOPE,
            country: "de",
            language: "DE",
        }
    }

    #[test]
    fn authorize_url_carries_pkce_and_country() {
        let p = Pkce::generate().unwrap();
        let built = Url::parse(&url().build(&p).unwrap()).unwrap();
        assert_eq!(built.host_str(), Some("accounts.lidl.com"));
        assert_eq!(built.path(), "/connect/authorize");
        let q: std::collections::HashMap<_, _> = built.query_pairs().into_owned().collect();
        assert_eq!(q["client_id"], "LidlPlusNativeClient");
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["scope"], "openid profile offline_access lpprofile lpapis");
        assert_eq!(q["redirect_uri"], "com.lidlplus.app://callback");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["code_challenge"], p.challenge());
        assert_eq!(q["state"], p.state);
        assert_eq!((q["Country"].as_str(), q["language"].as_str()), ("DE", "de-DE"));
        assert!(!built.as_str().contains(&p.verifier), "the verifier never leaves the server");
    }

    #[test]
    fn code_is_read_from_the_callback() {
        let ok = |s: &str| parse_callback(s, "st4te", REDIRECT_URI);
        assert_eq!(
            ok("com.lidlplus.app://callback?code=ABC123DEF&scope=openid&state=st4te").unwrap(),
            "ABC123DEF"
        );
        // no state echoed: accepted (the code is bound to our verifier anyway)
        assert_eq!(ok("com.lidlplus.app://callback?code=ABC123").unwrap(), "ABC123");
        // only the query pasted
        assert_eq!(ok("?code=ABC123&state=st4te").unwrap(), "ABC123");
        assert_eq!(ok("code=ABC123").unwrap(), "ABC123");
        assert_eq!(ok("  com.lidlplus.app://callback?code=ABC123\n").unwrap(), "ABC123");
    }

    #[test]
    fn bad_callbacks_are_refused_in_plain_words() {
        let err = |s: &str| parse_callback(s, "st4te", REDIRECT_URI).unwrap_err().to_string();
        assert!(err("com.lidlplus.app://callback?code=A&state=other").contains("different sign-in"));
        assert!(err("https://evil.example/callback?code=A").contains("should start with"));
        assert!(err("com.lidlplus.app://callback").contains("no code"));
        assert!(err("com.lidlplus.app://callback?code=a%20b").contains("damaged"));
        assert!(err("").contains("empty"));
        assert!(err("com.lidlplus.app://callback?error=access_denied&error_description=User%20cancelled")
            .contains("access_denied User cancelled"));
        assert!(err(&format!("com.lidlplus.app://callback?code={}", "A".repeat(600))).contains("damaged"));
    }
}
