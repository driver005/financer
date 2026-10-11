//! Wire-format tests: the real `genai` adapters talk to local fakes of the Anthropic and
//! OpenAI HTTP APIs. They prove the request shape (path, auth header, JSON mode, image
//! encoding) and that responses are parsed. They do NOT prove the real providers accept it;
//! that needs a real API key.

use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::HeaderMap;
use axum::routing::post;
use axum::{Json, Router};
use financer_llm::{GenaiProvider, LlmProvider, LlmSettings, Provider};
use serde_json::{json, Value};

type Seen = Arc<Mutex<Vec<(String, Value)>>>;

#[derive(Clone)]
struct Fake {
    seen: Seen,
    reply: Value,
}

async fn handle(State(f): State<Fake>, headers: HeaderMap, Json(body): Json<Value>) -> Json<Value> {
    let h = |n: &str| {
        headers
            .get(n)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string()
    };
    let auth = format!(
        "x-api-key={};anthropic-version={};authorization={}",
        h("x-api-key"),
        h("anthropic-version"),
        h("authorization")
    );
    f.seen.lock().unwrap().push((auth, body));
    Json(f.reply.clone())
}

/// Starts a fake server on a random port; returns its base URL and the recorded requests.
async fn serve(path: &'static str, reply: Value) -> (String, Seen) {
    let seen: Seen = Arc::default();
    let app = Router::new().route(path, post(handle)).with_state(Fake {
        seen: seen.clone(),
        reply,
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}/"), seen)
}

fn settings(provider: Provider, base: &str) -> LlmSettings {
    LlmSettings {
        provider,
        model: String::new(),
        api_key: "test-key-123".into(),
        base_url: Some(base.into()),
    }
}

fn anthropic_reply(text: &str) -> Value {
    json!({
        "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": "end_turn", "stop_sequence": null,
        "usage": {"input_tokens": 5, "output_tokens": 7}
    })
}

fn openai_reply(text: &str) -> Value {
    json!({
        "id": "chatcmpl-1", "object": "chat.completion", "created": 1, "model": "gpt-5.4-mini",
        "choices": [{"index": 0, "finish_reason": "stop",
            "message": {"role": "assistant", "content": text}}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 7, "total_tokens": 12}
    })
}

#[tokio::test]
async fn claude_json_request_and_response() {
    let (base, seen) = serve("/v1/messages", anthropic_reply("{\"ideas\":[]}")).await;
    let p = GenaiProvider::new(&settings(Provider::Claude, &format!("{base}v1"))).unwrap();
    let out = p
        .complete_json("Du bist Koch.", "Ideen bitte")
        .await
        .unwrap();
    assert_eq!(out.trim(), "{\"ideas\":[]}");

    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    let (auth, body) = &seen[0];
    assert!(auth.contains("x-api-key=test-key-123"), "{auth}");
    assert!(auth.contains("anthropic-version="), "{auth}");
    assert!(!auth.contains("anthropic-version=;"), "{auth}");
    assert_eq!(body["model"], "claude-haiku-5-5");
    assert!(body["system"].to_string().contains("Du bist Koch."));
    assert!(body["messages"].to_string().contains("Ideen bitte"));
}

#[tokio::test]
async fn claude_image_is_sent_as_base64_block() {
    let (base, seen) = serve("/v1/messages", anthropic_reply("REWE\nMILCH 1,19")).await;
    let p = GenaiProvider::new(&settings(Provider::Claude, &format!("{base}v1"))).unwrap();
    let out = p
        .describe_image("lies den Bon", "Text bitte", "image/jpeg", "QUJDRA==")
        .await
        .unwrap();
    assert_eq!(out, "REWE\nMILCH 1,19");

    let body = seen.lock().unwrap()[0].1.clone();
    let blocks = body["messages"][0]["content"].as_array().unwrap();
    let image = blocks
        .iter()
        .find(|b| b["type"] == "image")
        .unwrap_or_else(|| panic!("no image block in {body}"));
    assert_eq!(image["source"]["type"], "base64");
    assert_eq!(image["source"]["media_type"], "image/jpeg");
    assert_eq!(image["source"]["data"], "QUJDRA==");
}

#[tokio::test]
async fn openai_json_mode_request_and_response() {
    let (base, seen) = serve("/v1/chat/completions", openai_reply("{\"ideas\":[1]}")).await;
    let p = GenaiProvider::new(&settings(Provider::OpenAi, &format!("{base}v1"))).unwrap();
    let out = p
        .complete_json("Du bist Koch.", "Ideen bitte")
        .await
        .unwrap();
    assert_eq!(out.trim(), "{\"ideas\":[1]}");

    let seen = seen.lock().unwrap();
    let (auth, body) = &seen[0];
    assert!(auth.contains("authorization=Bearer test-key-123"), "{auth}");
    assert_eq!(body["model"], "gpt-5.4-mini");
    assert_eq!(body["response_format"]["type"], "json_object", "{body}");
    assert!(body["messages"].to_string().contains("Ideen bitte"));
}

#[tokio::test]
async fn openai_image_is_sent_as_data_uri() {
    let (base, seen) = serve("/v1/chat/completions", openai_reply("EDEKA\nBROT 2,49")).await;
    let p = GenaiProvider::new(&settings(Provider::OpenAi, &format!("{base}v1/"))).unwrap();
    let out = p
        .describe_image("lies den Bon", "Text bitte", "image/png", "QUJDRA==")
        .await
        .unwrap();
    assert_eq!(out, "EDEKA\nBROT 2,49");

    let body = seen.lock().unwrap()[0].1.clone();
    assert!(
        body.to_string().contains("data:image/png;base64,QUJDRA=="),
        "{body}"
    );
}

#[tokio::test]
async fn provider_errors_surface_as_request_errors() {
    // No route registered for the path the adapter uses: the fake answers 404.
    let (base, _) = serve("/nope", json!({})).await;
    let p = GenaiProvider::new(&settings(Provider::Claude, &format!("{base}v1"))).unwrap();
    assert!(p.complete_json("s", "u").await.is_err());
}
