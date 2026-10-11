//! HTTP access with manners: identifies itself, obeys robots.txt, spaces out requests per
//! host, and caps response size. Everything else talks to the [`Http`] trait so tests never
//! touch the network.

use std::collections::HashMap;
use std::sync::Mutex as StdMutex;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::Mutex;
use tokio::time::Instant;
use url::Url;

use crate::PriceError;

const MAX_BODY_BYTES: usize = 3 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

#[async_trait]
pub trait Http: Send + Sync {
    async fn get(&self, url: &str) -> Result<HttpResponse, PriceError>;
}

/// Plain reqwest client (rustls). No politeness; wrap it in [`PoliteHttp`].
pub struct ReqwestHttp {
    client: reqwest::Client,
}

impl ReqwestHttp {
    pub fn new(user_agent: &str) -> Result<Self, PriceError> {
        let client = reqwest::Client::builder()
            .user_agent(user_agent)
            .timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .map_err(|e| PriceError::Http(e.to_string()))?;
        Ok(Self { client })
    }
}

#[async_trait]
impl Http for ReqwestHttp {
    async fn get(&self, url: &str) -> Result<HttpResponse, PriceError> {
        let res = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| PriceError::Http(e.to_string()))?;
        let status = res.status().as_u16();
        let bytes = res
            .bytes()
            .await
            .map_err(|e| PriceError::Http(e.to_string()))?;
        if bytes.len() > MAX_BODY_BYTES {
            return Err(PriceError::Http(format!(
                "response larger than {MAX_BODY_BYTES} bytes"
            )));
        }
        Ok(HttpResponse {
            status,
            body: String::from_utf8_lossy(&bytes).into_owned(),
        })
    }
}

/// One `User-agent` group of a robots.txt: the agents it names and its `(allow, path)` rules.
type RobotsGroup = (Vec<String>, Vec<(bool, String)>);

/// The rules of one host's robots.txt that apply to us.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Robots {
    rules: Vec<(bool, String)>, // (allow, path pattern)
}

impl Robots {
    /// Rules for `agent` (the product token, e.g. `financer`), falling back to `*`.
    pub fn parse(text: &str, agent: &str) -> Robots {
        let agent = agent.to_lowercase();
        let mut groups: Vec<RobotsGroup> = Vec::new();
        let mut last_was_agent = false;
        for raw in text.lines() {
            let line = raw.split('#').next().unwrap_or("").trim();
            let Some((k, v)) = line.split_once(':') else {
                continue;
            };
            let (k, v) = (k.trim().to_lowercase(), v.trim());
            match k.as_str() {
                "user-agent" => {
                    if !last_was_agent {
                        groups.push((Vec::new(), Vec::new()));
                    }
                    groups
                        .last_mut()
                        .expect("group exists")
                        .0
                        .push(v.to_lowercase());
                    last_was_agent = true;
                }
                "allow" | "disallow" => {
                    last_was_agent = false;
                    if let Some(g) = groups.last_mut() {
                        if !v.is_empty() {
                            g.1.push((k == "allow", v.to_string()));
                        }
                    }
                }
                _ => last_was_agent = false,
            }
        }
        let pick = |name: &str| {
            groups
                .iter()
                .find(|(agents, _)| agents.iter().any(|a| a == name))
        };
        let rules = pick(&agent)
            .or_else(|| pick("*"))
            .map(|g| g.1.clone())
            .unwrap_or_default();
        Robots { rules }
    }

    fn matches(pattern: &str, path: &str) -> bool {
        let (pattern, anchored) = pattern
            .strip_suffix('$')
            .map_or((pattern, false), |p| (p, true));
        let mut pos = 0usize;
        let parts: Vec<&str> = pattern.split('*').collect();
        for (i, part) in parts.iter().enumerate() {
            if i == 0 {
                if !path.starts_with(part) {
                    return false;
                }
                pos = part.len();
            } else if let Some(found) = path[pos..].find(part) {
                pos += found + part.len();
            } else {
                return false;
            }
        }
        !anchored || pos == path.len() || parts.last().is_some_and(|l| l.is_empty())
    }

    /// Longest matching rule wins; Allow beats Disallow on a tie; no match means allowed.
    pub fn allows(&self, path: &str) -> bool {
        self.rules
            .iter()
            .filter(|(_, p)| Self::matches(p, path))
            .max_by_key(|(allow, p)| (p.len(), *allow))
            .is_none_or(|(allow, _)| *allow)
    }
}

pub struct PoliteHttp<H: Http> {
    inner: H,
    agent_token: String,
    min_delay: Duration,
    next_slot: Mutex<HashMap<String, Instant>>,
    robots: StdMutex<HashMap<String, Robots>>,
}

impl<H: Http> PoliteHttp<H> {
    pub fn new(inner: H, agent_token: &str, min_delay: Duration) -> Self {
        Self {
            inner,
            agent_token: agent_token.to_string(),
            min_delay,
            next_slot: Mutex::new(HashMap::new()),
            robots: StdMutex::new(HashMap::new()),
        }
    }

    async fn wait_turn(&self, host: &str) {
        let wait_until = {
            let mut slots = self.next_slot.lock().await;
            let now = Instant::now();
            let at = slots.get(host).copied().filter(|t| *t > now).unwrap_or(now);
            slots.insert(host.to_string(), at + self.min_delay);
            at
        };
        tokio::time::sleep_until(wait_until).await;
    }

    /// robots.txt rules for the origin (scheme, host and port) of `url`, fetched once.
    async fn robots_for(&self, url: &Url) -> Result<Robots, PriceError> {
        let origin = url.origin().ascii_serialization();
        if let Some(r) = self.robots.lock().expect("robots lock").get(&origin) {
            return Ok(r.clone());
        }
        let host = origin.clone();
        self.wait_turn(&host).await;
        let rules = match self.inner.get(&format!("{origin}/robots.txt")).await {
            Ok(res) if res.status < 300 => Robots::parse(&res.body, &self.agent_token),
            Ok(res) if res.status < 500 => Robots::default(), // 4xx: no robots.txt, everything allowed
            // 5xx or unreachable: be conservative and do not fetch (and do not cache the failure)
            Ok(res) => {
                return Err(PriceError::Blocked(format!(
                    "robots.txt of {host} returned {}",
                    res.status
                )))
            }
            Err(e) => {
                return Err(PriceError::Blocked(format!(
                    "robots.txt of {host} unreachable: {e}"
                )))
            }
        };
        self.robots
            .lock()
            .expect("robots lock")
            .insert(origin, rules.clone());
        Ok(rules)
    }
}

#[async_trait]
impl<H: Http> Http for PoliteHttp<H> {
    async fn get(&self, url: &str) -> Result<HttpResponse, PriceError> {
        let parsed =
            Url::parse(url).map_err(|e| PriceError::Http(format!("bad URL {url:?}: {e}")))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(PriceError::Http(format!("unsupported scheme in {url:?}")));
        }
        if !parsed.has_host() {
            return Err(PriceError::Http(format!("no host in {url:?}")));
        }
        // rate limits and robots rules are per origin: the same host on another port is another site
        let host = parsed.origin().ascii_serialization();

        let robots = self.robots_for(&parsed).await?;
        let path_and_query = match parsed.query() {
            Some(q) => format!("{}?{q}", parsed.path()),
            None => parsed.path().to_string(),
        };
        if !robots.allows(&path_and_query) {
            return Err(PriceError::Blocked(format!(
                "robots.txt of {host} disallows {path_and_query}"
            )));
        }
        self.wait_turn(&host).await;
        self.inner.get(url).await
    }
}

/// Canned HTTP for tests (also used by the API crate's tests); never touches the network.
pub mod fake {
    use super::*;

    /// Canned responses by exact URL; records every request.
    #[derive(Default)]
    pub struct FakeHttp {
        pub routes: StdMutex<HashMap<String, Result<HttpResponse, String>>>,
        pub log: StdMutex<Vec<String>>,
    }

    impl FakeHttp {
        pub fn with(routes: Vec<(&str, u16, &str)>) -> Self {
            let f = FakeHttp::default();
            for (url, status, body) in routes {
                f.routes.lock().unwrap().insert(
                    url.into(),
                    Ok(HttpResponse {
                        status,
                        body: body.into(),
                    }),
                );
            }
            f
        }
    }

    #[async_trait]
    impl Http for FakeHttp {
        async fn get(&self, url: &str) -> Result<HttpResponse, PriceError> {
            self.log.lock().unwrap().push(url.to_string());
            match self.routes.lock().unwrap().get(url) {
                Some(Ok(r)) => Ok(r.clone()),
                Some(Err(e)) => Err(PriceError::Http(e.clone())),
                None => Ok(HttpResponse {
                    status: 404,
                    body: String::new(),
                }),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::FakeHttp;
    use super::*;

    const ROBOTS: &str = "\
User-agent: *
Disallow: /private/
Disallow: /search*?q=
Allow: /private/public.html

User-agent: financer
Disallow: /blocked
";

    #[test]
    fn parses_groups_and_prefers_our_own() {
        let star = Robots::parse(ROBOTS, "otherbot");
        assert!(!star.allows("/private/x"));
        assert!(star.allows("/private/public.html")); // longer Allow beats Disallow
        assert!(!star.allows("/search/x?q=milch"));
        assert!(star.allows("/angebote"));

        let ours = Robots::parse(ROBOTS, "Financer");
        assert!(!ours.allows("/blocked/page"));
        assert!(ours.allows("/private/x")); // our group replaces the * group
    }

    #[test]
    fn empty_and_missing_rules_allow_everything() {
        assert!(Robots::parse("", "financer").allows("/anything"));
        assert!(Robots::parse("User-agent: *\nDisallow:\n", "financer").allows("/anything"));
        assert!(!Robots::parse("User-agent: *\nDisallow: /\n", "financer").allows("/anything"));
    }

    #[test]
    fn end_anchor_and_wildcards() {
        let r = Robots::parse("User-agent: *\nDisallow: /*.pdf$\n", "x");
        assert!(!r.allows("/a/b.pdf"));
        assert!(r.allows("/a/b.pdf.html"));
    }

    #[tokio::test]
    async fn fetches_robots_once_and_blocks_disallowed_paths() {
        let fake = FakeHttp::with(vec![
            (
                "https://shop.test/robots.txt",
                200,
                "User-agent: *\nDisallow: /private/\n",
            ),
            ("https://shop.test/angebote", 200, "<html>ok</html>"),
        ]);
        let http = PoliteHttp::new(fake, "financer", Duration::ZERO);

        assert_eq!(
            http.get("https://shop.test/angebote").await.unwrap().body,
            "<html>ok</html>"
        );
        assert!(matches!(
            http.get("https://shop.test/private/x").await,
            Err(PriceError::Blocked(_))
        ));
        http.get("https://shop.test/angebote").await.unwrap();

        let log = http.inner.log.lock().unwrap().clone();
        assert_eq!(log.iter().filter(|u| u.ends_with("/robots.txt")).count(), 1);
        assert!(
            !log.iter().any(|u| u.contains("/private/")),
            "disallowed URL must never be requested"
        );
    }

    #[tokio::test]
    async fn missing_robots_allows_but_server_errors_block() {
        let ok = PoliteHttp::new(
            FakeHttp::with(vec![("https://a.test/x", 200, "hi")]),
            "financer",
            Duration::ZERO,
        );
        assert_eq!(ok.get("https://a.test/x").await.unwrap().body, "hi"); // robots.txt -> 404

        let broken = PoliteHttp::new(
            FakeHttp::with(vec![
                ("https://b.test/robots.txt", 503, ""),
                ("https://b.test/x", 200, "hi"),
            ]),
            "financer",
            Duration::ZERO,
        );
        assert!(matches!(
            broken.get("https://b.test/x").await,
            Err(PriceError::Blocked(_))
        ));
        assert!(!broken
            .inner
            .log
            .lock()
            .unwrap()
            .contains(&"https://b.test/x".to_string()));
    }

    #[tokio::test]
    async fn robots_url_keeps_the_port_and_scheme() {
        let fake = FakeHttp::with(vec![
            (
                "http://127.0.0.1:9100/robots.txt",
                200,
                "User-agent: *\nDisallow: /nope\n",
            ),
            ("http://127.0.0.1:9100/offers", 200, "ok"),
        ]);
        let http = PoliteHttp::new(fake, "financer", Duration::ZERO);
        assert_eq!(
            http.get("http://127.0.0.1:9100/offers").await.unwrap().body,
            "ok"
        );
        assert!(matches!(
            http.get("http://127.0.0.1:9100/nope").await,
            Err(PriceError::Blocked(_))
        ));
        let log = http.inner.log.lock().unwrap().clone();
        assert_eq!(log[0], "http://127.0.0.1:9100/robots.txt");
    }

    #[tokio::test]
    async fn rejects_odd_urls() {
        let http = PoliteHttp::new(FakeHttp::default(), "financer", Duration::ZERO);
        assert!(http.get("file:///etc/passwd").await.is_err());
        assert!(http.get("not a url").await.is_err());
        assert!(http.inner.log.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn spaces_requests_to_the_same_host() {
        let fake = FakeHttp::with(vec![
            ("https://c.test/robots.txt", 404, ""),
            ("https://c.test/1", 200, "1"),
            ("https://c.test/2", 200, "2"),
        ]);
        let http = PoliteHttp::new(fake, "financer", Duration::from_secs(2));
        let start = Instant::now();
        http.get("https://c.test/1").await.unwrap();
        http.get("https://c.test/2").await.unwrap();
        // robots.txt, /1 and /2 are three requests to one host: at least two gaps of 2 s
        assert!(
            start.elapsed() >= Duration::from_secs(4),
            "elapsed {:?}",
            start.elapsed()
        );
    }
}
