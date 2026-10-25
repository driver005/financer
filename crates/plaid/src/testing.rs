//! A scripted Plaid for tests: answers by path, in order, and remembers what was asked.
//! Public so that the API crate's tests can use it too.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use async_trait::async_trait;

use crate::http::{HttpAnswer, PlaidHttp};
use crate::PlaidError;

#[derive(Default)]
pub struct FakePlaidHttp {
    script: Mutex<HashMap<String, VecDeque<HttpAnswer>>>,
    /// `(path, body without credentials)` of every call.
    pub calls: Mutex<Vec<(String, serde_json::Value)>>,
}

impl FakePlaidHttp {
    pub fn new() -> Self {
        Self::default()
    }

    /// The next answer for `path` (a path such as `/link/token/create`). The last one repeats.
    pub fn answer(self, path: &str, status: u16, body: &str) -> Self {
        self.script
            .lock()
            .expect("fake lock")
            .entry(path.to_string())
            .or_default()
            .push_back(HttpAnswer {
                status,
                body: body.to_string(),
            });
        self
    }

    pub fn paths(&self) -> Vec<String> {
        self.calls
            .lock()
            .expect("fake lock")
            .iter()
            .map(|(p, _)| p.clone())
            .collect()
    }

    pub fn body_of(&self, nth: usize) -> serde_json::Value {
        self.calls.lock().expect("fake lock")[nth].1.clone()
    }
}

#[async_trait]
impl PlaidHttp for FakePlaidHttp {
    async fn post_json(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> Result<HttpAnswer, PlaidError> {
        let path = url
            .find("plaid.com")
            .map(|i| &url[i + "plaid.com".len()..])
            .or_else(|| {
                url.find("://")
                    .and_then(|i| url[i + 3..].find('/').map(|j| &url[i + 3 + j..]))
            })
            .unwrap_or(url)
            .to_string();
        let mut shown = body.clone();
        if let Some(map) = shown.as_object_mut() {
            // the test must never see (or print) the credentials
            map.remove("secret");
            map.remove("client_id");
        }
        self.calls
            .lock()
            .expect("fake lock")
            .push((path.clone(), shown));
        let mut script = self.script.lock().expect("fake lock");
        let queue = script
            .get_mut(&path)
            .ok_or_else(|| PlaidError::Connection(format!("the fake has no answer for {path}")))?;
        let next = if queue.len() > 1 {
            queue.pop_front().expect("checked")
        } else {
            queue.front().cloned().expect("an answer is registered")
        };
        Ok(next)
    }
}
