//! The progress notification of an index run: what the title, body and bar say, and when a new state
//! is worth showing. Polling and showing (`followJob`) stay in TypeScript beside the notification.

use serde_json::{json, Value};

use crate::js::{num, round, string, text, truthy};

const SEGMENTS: i64 = 10;

/// `▰▰▰▱▱▱▱▱▱▱ 30 %`
pub fn text_bar(percent: f64) -> String {
    let p = round(percent).clamp(0, 100);
    let filled = round(p as f64 / 100.0 * SEGMENTS as f64);
    format!(
        "{}{} {p} %",
        "▰".repeat(filled as usize),
        "▱".repeat((SEGMENTS - filled) as usize)
    )
}

fn count(n: f64) -> String {
    string(&Value::from(n))
}

/// What the notification shows for a run in this state.
pub fn progress_model(query: &str, s: &Value) -> Value {
    let phase = text(s, "phase").unwrap_or("");
    let finished = matches!(phase, "done" | "failed" | "cancelled");
    let percent = num(s, "percent").unwrap_or(0.0);
    let message = text(s, "message").unwrap_or("");
    let (title, body, indeterminate) = match phase {
        "done" => {
            let n = num(s, "products").unwrap_or(0.0);
            (
                "Search index ready".to_string(),
                if n == 0.0 {
                    format!("Nothing found for \"{query}\"")
                } else {
                    format!(
                        "{} {} indexed for \"{query}\"",
                        count(n),
                        if n == 1.0 { "product" } else { "products" }
                    )
                },
                false,
            )
        }
        "failed" => (
            "Indexing failed".into(),
            if message.is_empty() {
                "No source could be read".into()
            } else {
                message.to_string()
            },
            false,
        ),
        "cancelled" => (
            "Indexing stopped".into(),
            format!("Stopped searching for \"{query}\""),
            false,
        ),
        "queued" => ("Preparing search".into(), format!("\"{query}\""), true),
        _ => {
            let total = num(s, "total").unwrap_or(0.0);
            (
                "Reading shops".into(),
                if total > 0.0 {
                    format!(
                        "{message} · page {} of {}",
                        count(num(s, "done").unwrap_or(0.0)),
                        count(total)
                    )
                } else {
                    message.to_string()
                },
                total == 0.0,
            )
        }
    };
    json!({
        "title": title,
        "body": body,
        "percent": s.get("percent").cloned().unwrap_or(json!(0)),
        "indeterminate": indeterminate,
        "ongoing": !finished,
        "bar": text_bar(percent),
        "finished": finished,
        "phase": phase,
    })
}

/// Whether a new model is worth showing. Notifications that change many times a second get
/// throttled by the system and drain the battery, so: always show the first and the last, and in
/// between only when the percent moved and a second has passed.
pub fn worth_showing(
    prev: Option<&Value>,
    next: &Value,
    last_shown_ms: f64,
    now_ms: f64,
    min_gap_ms: f64,
) -> bool {
    let Some(prev) = prev else {
        return true;
    };
    if truthy(next.get("finished")) || prev.get("phase") != next.get("phase") {
        return true;
    }
    if now_ms - last_shown_ms < min_gap_ms {
        return false;
    }
    prev.get("percent") != next.get("percent") || prev.get("body") != next.get("body")
}

/// A poll of the job answered: what the notification does next. `prev` is the model shown before.
/// The answer is `{ model, action }` with the action `finish` (the run ended), `show` or `skip`.
pub fn follow_ok(
    query: &str,
    progress: &Value,
    prev: Option<&Value>,
    last_shown_ms: f64,
    now_ms: f64,
    min_gap_ms: f64,
) -> Value {
    let model = progress_model(query, progress);
    let action = if truthy(model.get("finished")) {
        "finish"
    } else if worth_showing(prev, &model, last_shown_ms, now_ms, min_gap_ms) {
        "show"
    } else {
        "skip"
    };
    json!({ "model": model, "action": action })
}

/// A poll failed: the count of failures in a row, and the final model once the server is given up on.
pub fn follow_failed(query: &str, failures: f64, max_failures: f64, prev: Option<&Value>) -> Value {
    let failures = failures + 1.0;
    let finish = (failures >= max_failures).then(|| {
        let percent = prev.and_then(|p| num(p, "percent")).unwrap_or(0.0);
        progress_model(
            query,
            &json!({ "phase": "failed", "message": "Lost contact with the search", "done": 0, "total": 0, "products": 0, "failed": 0, "percent": percent }),
        )
    });
    json!({ "failures": failures, "finish": finish })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_text_bar_fills_in_tenths() {
        assert_eq!(text_bar(0.0), "▱▱▱▱▱▱▱▱▱▱ 0 %");
        assert_eq!(text_bar(30.0), "▰▰▰▱▱▱▱▱▱▱ 30 %");
        assert_eq!(text_bar(250.0), "▰▰▰▰▰▰▰▰▰▰ 100 %");
        assert_eq!(text_bar(-5.0), "▱▱▱▱▱▱▱▱▱▱ 0 %");
    }

    #[test]
    fn each_phase_has_its_words() {
        let s = |phase: &str, extra: Value| {
            let mut v = json!({ "phase": phase, "message": "", "done": 0, "total": 0, "products": 0, "failed": 0, "percent": 0 });
            for (k, x) in extra.as_object().unwrap() {
                v[k] = x.clone();
            }
            v
        };
        let m = progress_model("phone", &s("done", json!({ "products": 3 })));
        assert_eq!(
            (
                m["title"].as_str(),
                m["body"].as_str(),
                m["finished"].as_bool()
            ),
            (
                Some("Search index ready"),
                Some("3 products indexed for \"phone\""),
                Some(true)
            )
        );
        assert_eq!(
            progress_model("phone", &s("failed", json!({})))["body"],
            "No source could be read"
        );
        let r = progress_model(
            "phone",
            &s(
                "running",
                json!({ "message": "Lidl", "done": 2, "total": 9, "percent": 20 }),
            ),
        );
        assert_eq!(
            (
                r["body"].as_str(),
                r["indeterminate"].as_bool(),
                r["ongoing"].as_bool()
            ),
            (Some("Lidl · page 2 of 9"), Some(false), Some(true))
        );
        assert_eq!(
            progress_model("phone", &s("queued", json!({})))["indeterminate"],
            true
        );
    }

    #[test]
    fn following_a_job_shows_throttles_finishes_and_gives_up() {
        let running = json!({ "phase": "running", "message": "Lidl", "done": 1, "total": 9, "products": 0, "failed": 0, "percent": 10 });
        let first = follow_ok("phone", &running, None, 0.0, 0.0, 1000.0);
        assert_eq!(first["action"], "show");
        let again = follow_ok("phone", &running, Some(&first["model"]), 0.0, 200.0, 1000.0);
        assert_eq!(again["action"], "skip");
        let done = follow_ok(
            "phone",
            &json!({ "phase": "done", "products": 2, "percent": 100 }),
            Some(&first["model"]),
            0.0,
            1.0,
            1000.0,
        );
        assert_eq!(done["action"], "finish");
        assert_eq!(
            follow_failed("phone", 0.0, 3.0, None)["finish"],
            Value::Null
        );
        let last = follow_failed("phone", 2.0, 3.0, Some(&first["model"]));
        assert_eq!(last["finish"]["title"], "Indexing failed");
        assert_eq!(last["finish"]["percent"].as_f64(), Some(10.0));
    }

    #[test]
    fn updates_are_throttled_but_the_first_and_last_always_show() {
        let a = json!({ "phase": "running", "percent": 10, "body": "x", "finished": false });
        let b = json!({ "phase": "running", "percent": 20, "body": "x", "finished": false });
        assert!(worth_showing(None, &a, 0.0, 0.0, 1000.0));
        assert!(!worth_showing(Some(&a), &b, 0.0, 500.0, 1000.0));
        assert!(worth_showing(Some(&a), &b, 0.0, 1500.0, 1000.0));
        assert!(!worth_showing(Some(&a), &a, 0.0, 1500.0, 1000.0));
        assert!(worth_showing(
            Some(&a),
            &json!({ "phase": "done", "finished": true }),
            0.0,
            1.0,
            1000.0
        ));
    }
}
