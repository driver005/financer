//! The shopping assistant's texts for prices, discounts and ages. The app is English with German
//! number formatting, like the finance app.

use serde_json::Value;

use crate::js::{has, num, round, text, truthy};

/// `1.299,00 €`; a minus sign in front of a negative amount.
pub fn format_cents(cents: f64) -> String {
    let sign = if cents < 0.0 { "-" } else { "" };
    let abs = round(cents.abs());
    let digits = (abs / 100).to_string();
    let mut grouped = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            grouped.push('.');
        }
        grouped.push(c);
    }
    format!("{sign}{grouped},{:02} €", abs % 100)
}

/// `649,00 €`, or `19,99 € / month` for plans (`per_month`).
pub fn format_price(cents: Option<f64>, per_month: bool) -> String {
    match cents {
        None => "no price".into(),
        Some(c) if per_month => format!("{} / month", format_cents(c)),
        Some(c) => format_cents(c),
    }
}

pub fn format_percent(pct: f64) -> String {
    format!("{} %", round(pct))
}

/// `Save 12,34 € a month (296,16 € over 24 months)`, or the opposite when it would cost more.
pub fn saving_text(
    per_month_cents: f64,
    over_horizon_cents: f64,
    months: f64,
    current: Option<&str>,
) -> String {
    let from = match current {
        Some(c) if !c.is_empty() => format!(" than {c}"),
        _ => " than now".into(),
    };
    if per_month_cents > 0.0 {
        format!(
            "Save {} a month ({} over {} months)",
            format_cents(per_month_cents),
            format_cents(over_horizon_cents),
            crate::js::string(&Value::from(months))
        )
    } else if per_month_cents < 0.0 {
        format!("{} a month more{from}", format_cents(-per_month_cents))
    } else {
        format!("Same cost{from}")
    }
}

pub fn verdict_text(v: &str) -> &'static str {
    match v {
        "none" => "No deal",
        "fair" => "Slightly below its usual price",
        "good" => "Good deal",
        "great" => "Great deal",
        _ => "",
    }
}

/// One line on why a price is or is not a deal.
pub fn deal_line(d: &Value) -> String {
    if text(d, "verdict") == Some("none") {
        return if num(d, "samples").unwrap_or(0.0) >= 3.0 {
            "Priced as usual"
        } else {
            "Not enough price history yet"
        }
        .into();
    }
    let mut parts = vec![format!(
        "{} below its usual price",
        format_percent(num(d, "discount_pct").unwrap_or(0.0))
    )];
    if truthy(d.get("all_time_low")) {
        parts.push("lowest we have seen".into());
    } else if truthy(d.get("lowest_90d")) {
        parts.push("lowest in 90 days".into());
    }
    parts.join(", ")
}

/// `3 days ago`, `just now`.
pub fn ago(unix_seconds: f64, now_seconds: f64) -> String {
    let diff = (now_seconds - unix_seconds).max(0.0);
    for (size, name) in [(86_400.0, "day"), (3_600.0, "hour"), (60.0, "minute")] {
        if diff >= size {
            let n = (diff / size).floor() as i64;
            return format!("{n} {name}{} ago", if n == 1 { "" } else { "s" });
        }
    }
    "just now".into()
}

/// The cheapest offer that is not known to be out of stock.
pub fn cheapest_offer(offers: &[Value]) -> Option<Value> {
    let mut in_stock: Vec<&Value> = offers
        .iter()
        .filter(|o| o.get("in_stock") != Some(&Value::Bool(false)))
        .collect();
    in_stock.sort_by(|a, b| {
        num(a, "price_cents")
            .unwrap_or(f64::NAN)
            .partial_cmp(&num(b, "price_cents").unwrap_or(f64::NAN))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    in_stock.first().map(|o| (*o).clone())
}

/// The contract of a plan in words: `24 months, 6 months at 9,99 €, 39,99 € to set up`.
pub fn plan_terms(o: &Value) -> String {
    let Some(r) = o.get("recurring").filter(|r| !r.is_null()) else {
        return String::new();
    };
    let mut parts = vec![];
    parts.push(match num(r, "min_term_months").filter(|m| *m != 0.0) {
        Some(m) => format!("{} months", crate::js::string(&Value::from(m))),
        None => "cancel monthly".into(),
    });
    if let (Some(months), true) = (
        num(r, "promo_months").filter(|m| *m != 0.0),
        has(r, "promo_monthly_cents"),
    ) {
        parts.push(format!(
            "first {} months at {}",
            crate::js::string(&Value::from(months)),
            format_cents(num(r, "promo_monthly_cents").unwrap_or(0.0))
        ));
    }
    if let Some(s) = num(r, "setup_cents").filter(|s| *s != 0.0) {
        parts.push(format!("{} to set up", format_cents(s)));
    }
    if let Some(c) = num(r, "cashback_cents").filter(|c| *c != 0.0) {
        parts.push(format!("{} cash back", format_cents(c)));
    }
    parts.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prices_are_german() {
        assert_eq!(format_cents(129_900.0), "1.299,00 €");
        assert_eq!(format_cents(-5.0), "-0,05 €");
        assert_eq!(format_cents(100_000_000.0), "1.000.000,00 €");
        assert_eq!(format_price(None, false), "no price");
        assert_eq!(format_price(Some(1999.0), true), "19,99 € / month");
    }

    #[test]
    fn savings_and_deals_are_said_in_words() {
        assert_eq!(
            saving_text(1234.0, 29616.0, 24.0, None),
            "Save 12,34 € a month (296,16 € over 24 months)"
        );
        assert_eq!(
            saving_text(-500.0, 0.0, 24.0, Some("Telekom")),
            "5,00 € a month more than Telekom"
        );
        assert_eq!(saving_text(0.0, 0.0, 24.0, None), "Same cost than now");
        assert_eq!(
            deal_line(&json!({ "verdict": "good", "discount_pct": 12.4, "all_time_low": true })),
            "12 % below its usual price, lowest we have seen"
        );
        assert_eq!(
            deal_line(&json!({ "verdict": "none", "samples": 1 })),
            "Not enough price history yet"
        );
        assert_eq!(ago(0.0, 7200.0), "2 hours ago");
        assert_eq!(ago(0.0, 30.0), "just now");
    }

    #[test]
    fn plans_read_as_terms() {
        let o = json!({ "recurring": { "min_term_months": 24, "promo_months": 6, "promo_monthly_cents": 999, "setup_cents": 3999 } });
        assert_eq!(
            plan_terms(&o),
            "24 months, first 6 months at 9,99 €, 39,99 € to set up"
        );
        assert_eq!(plan_terms(&json!({ "recurring": {} })), "cancel monthly");
        assert_eq!(plan_terms(&json!({})), "");
        let offers = [
            json!({ "price_cents": 500 }),
            json!({ "price_cents": 300, "in_stock": false }),
            json!({ "price_cents": 400 }),
        ];
        assert_eq!(cheapest_offer(&offers).unwrap()["price_cents"], 400);
    }
}
