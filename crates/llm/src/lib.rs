//! Provider-agnostic LLM access. Claude and OpenAI are selectable in settings; the rest of
//! the code only sees [`LlmProvider`], so a different library or provider is a one-file change.

use std::fmt;
use std::sync::Mutex;

use async_trait::async_trait;
use genai::adapter::AdapterKind;
use genai::chat::{ChatMessage, ChatOptions, ChatRequest, ChatResponseFormat};
use genai::resolver::{AuthData, AuthResolver};
use genai::{Client, ModelIden};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Claude,
    OpenAi,
}

impl Provider {
    /// Cheap, fast model that is plenty for recipe ideas. Override via [`LlmSettings::model`].
    pub fn default_model(self) -> &'static str {
        match self {
            Provider::Claude => "claude-haiku-5-5",
            Provider::OpenAi => "gpt-5.4-mini",
        }
    }

    fn adapter(self) -> AdapterKind {
        match self {
            Provider::Claude => AdapterKind::Anthropic,
            Provider::OpenAi => AdapterKind::OpenAI,
        }
    }
}

/// Which provider and model to use, and the key for it.
#[derive(Clone, Serialize, Deserialize)]
pub struct LlmSettings {
    pub provider: Provider,
    /// Falls back to [`Provider::default_model`] when empty.
    #[serde(default)]
    pub model: String,
    pub api_key: String,
}

// Never print the key, even in `{:?}` logs.
impl fmt::Debug for LlmSettings {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("LlmSettings")
            .field("provider", &self.provider)
            .field("model", &self.model)
            .field("api_key", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("no API key configured for {0:?}")]
    MissingKey(Provider),
    #[error("the model returned an empty answer")]
    Empty,
    #[error("LLM request failed: {0}")]
    Request(String),
}

/// One request/response round trip that must come back as JSON text.
#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn complete_json(&self, system: &str, user: &str) -> Result<String, LlmError>;
}

/// Real provider, backed by the `genai` crate.
pub struct GenaiProvider {
    client: Client,
    model: String,
}

impl GenaiProvider {
    pub fn new(settings: &LlmSettings) -> Result<Self, LlmError> {
        let key = settings.api_key.trim().to_string();
        if key.is_empty() {
            return Err(LlmError::MissingKey(settings.provider));
        }
        let auth = AuthResolver::from_resolver_fn(
            move |_: ModelIden| -> Result<Option<AuthData>, genai::resolver::Error> {
                Ok(Some(AuthData::from_single(key.clone())))
            },
        );
        let client = Client::builder()
            .with_adapter_kind(settings.provider.adapter())
            .with_auth_resolver(auth)
            .build();
        let model = match settings.model.trim() {
            "" => settings.provider.default_model().to_string(),
            m => m.to_string(),
        };
        Ok(Self { client, model })
    }
}

#[async_trait]
impl LlmProvider for GenaiProvider {
    async fn complete_json(&self, system: &str, user: &str) -> Result<String, LlmError> {
        let req = ChatRequest::new(vec![ChatMessage::system(system), ChatMessage::user(user)]);
        let opts = ChatOptions::default().with_response_format(ChatResponseFormat::JsonMode);
        let res = self
            .client
            .exec_chat(self.model.as_str(), req, Some(&opts))
            .await
            .map_err(|e| LlmError::Request(e.to_string()))?;
        res.into_first_text()
            .filter(|t| !t.trim().is_empty())
            .ok_or(LlmError::Empty)
    }
}

/// Test double: returns canned answers in order and records what it was asked.
pub struct MockProvider {
    answers: Mutex<Vec<Result<String, String>>>,
    pub requests: Mutex<Vec<(String, String)>>,
}

impl MockProvider {
    pub fn with_answers(answers: Vec<Result<String, String>>) -> Self {
        Self {
            answers: Mutex::new(answers.into_iter().rev().collect()),
            requests: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait]
impl LlmProvider for MockProvider {
    async fn complete_json(&self, system: &str, user: &str) -> Result<String, LlmError> {
        self.requests
            .lock()
            .unwrap()
            .push((system.to_string(), user.to_string()));
        match self.answers.lock().unwrap().pop() {
            Some(Ok(text)) => Ok(text),
            Some(Err(e)) => Err(LlmError::Request(e)),
            None => Err(LlmError::Empty),
        }
    }
}

/// Build the real provider for the given settings.
pub fn provider_for(settings: &LlmSettings) -> Result<Box<dyn LlmProvider>, LlmError> {
    Ok(Box::new(GenaiProvider::new(settings)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_output_never_contains_the_key() {
        let s = LlmSettings {
            provider: Provider::Claude,
            model: String::new(),
            api_key: "sk-secret-123".into(),
        };
        let shown = format!("{s:?}");
        assert!(!shown.contains("sk-secret-123"));
        assert!(shown.contains("redacted"));
    }

    #[test]
    fn empty_key_is_rejected_before_any_request() {
        let s = LlmSettings {
            provider: Provider::OpenAi,
            model: String::new(),
            api_key: "  ".into(),
        };
        assert!(matches!(
            GenaiProvider::new(&s),
            Err(LlmError::MissingKey(Provider::OpenAi))
        ));
    }

    #[test]
    fn provider_names_and_default_models() {
        assert_eq!(
            serde_json::to_string(&Provider::OpenAi).unwrap(),
            "\"open_ai\""
        );
        assert_eq!(
            serde_json::from_str::<Provider>("\"claude\"").unwrap(),
            Provider::Claude
        );
        assert!(Provider::Claude.default_model().starts_with("claude-"));
        assert!(Provider::OpenAi.default_model().starts_with("gpt-"));
    }

    #[tokio::test]
    async fn mock_returns_answers_in_order_and_records_requests() {
        let m = MockProvider::with_answers(vec![Ok("{\"a\":1}".into()), Err("boom".into())]);
        assert_eq!(m.complete_json("sys", "u1").await.unwrap(), "{\"a\":1}");
        assert!(
            matches!(m.complete_json("sys", "u2").await, Err(LlmError::Request(e)) if e == "boom")
        );
        assert!(matches!(
            m.complete_json("sys", "u3").await,
            Err(LlmError::Empty)
        ));
        assert_eq!(m.requests.lock().unwrap().len(), 3);
    }
}
