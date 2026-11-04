//! JSON of any shape, for the two places the finance API's schema says "any".

/// Any JSON value. JavaScript gets it as text (`JSON.parse` it).
pub type JsonValue = serde_json::Value;

uniffi::custom_type!(JsonValue, String, {
    remote,
    try_lift: |text| Ok(serde_json::from_str(&text)?),
    lower: |value| value.to_string(),
});
