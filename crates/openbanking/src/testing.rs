//! A scripted aggregator for tests: answers by `METHOD path`, in order, and remembers what was
//! asked. Public so that the API crate's tests can use it too.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use async_trait::async_trait;

use crate::http::{Answer, Body, OpenHttp, Request};

#[derive(Debug, Clone)]
pub struct Call {
    pub method: &'static str,
    /// The path with its query, without the host.
    pub path: String,
    /// The JSON or form body without keys, secrets and passwords.
    pub body: serde_json::Value,
    pub bearer: bool,
}

#[derive(Default)]
pub struct FakeHttp {
    script: Mutex<HashMap<String, VecDeque<Answer>>>,
    pub calls: Mutex<Vec<Call>>,
}

const SECRET_FIELDS: &[&str] = &[
    "secret_id",
    "secret_key",
    "client_id",
    "client_secret",
    "password",
    "username",
];

impl FakeHttp {
    pub fn new() -> Self {
        Self::default()
    }

    /// The next answer for `"GET /api/v2/requisitions/abc/"` (method, a space, the path with
    /// its query when the test cares). The last one repeats. A key without a query also
    /// matches calls that have one, unless a more exact key is registered.
    pub fn answer(self, key: &str, status: u16, body: &str) -> Self {
        self.script
            .lock()
            .expect("fake lock")
            .entry(key.to_string())
            .or_default()
            .push_back(Answer {
                status,
                body: body.to_string(),
            });
        self
    }

    pub fn keys(&self) -> Vec<String> {
        self.calls
            .lock()
            .expect("fake lock")
            .iter()
            .map(|c| format!("{} {}", c.method, c.path))
            .collect()
    }

    pub fn call(&self, nth: usize) -> Call {
        self.calls.lock().expect("fake lock")[nth].clone()
    }

    pub fn count(&self, prefix: &str) -> usize {
        self.keys().iter().filter(|k| k.starts_with(prefix)).count()
    }
}

fn path_of(url: &str) -> String {
    url.find("://")
        .and_then(|i| url[i + 3..].find('/').map(|j| url[i + 3 + j..].to_string()))
        .unwrap_or_else(|| url.to_string())
}

#[async_trait]
impl OpenHttp for FakeHttp {
    async fn send(&self, request: Request) -> Result<Answer, String> {
        let path = path_of(&request.url);
        let mut shown = match &request.body {
            Body::None => serde_json::Value::Null,
            Body::Json(v) => v.clone(),
            Body::Form(fields) => serde_json::Value::Object(
                fields
                    .iter()
                    .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
                    .collect(),
            ),
        };
        if let Some(map) = shown.as_object_mut() {
            for f in SECRET_FIELDS {
                map.remove(*f);
            }
        }
        let method = request.method.as_str();
        self.calls.lock().expect("fake lock").push(Call {
            method,
            path: path.clone(),
            body: shown,
            bearer: request.bearer.is_some(),
        });
        let exact = format!("{method} {path}");
        let bare = format!("{method} {}", path.split('?').next().unwrap_or(&path));
        let mut script = self.script.lock().expect("fake lock");
        let key = if script.contains_key(&exact) { exact } else { bare };
        let queue = script
            .get_mut(&key)
            .ok_or_else(|| format!("the fake has no answer for {key}"))?;
        let next = if queue.len() > 1 {
            queue.pop_front().expect("checked")
        } else {
            queue.front().cloned().expect("an answer is registered")
        };
        Ok(next)
    }
}
