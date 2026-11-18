//! Pantry business logic. Pure, local, no network and no UI.
//! Expo calls the same functions through the WebAssembly exports at the bottom.

use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

const MONTHS: [&str; 12] = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = y - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    (y + if m <= 2 { 1 } else { 0 }, m, d)
}

fn iso_weekday(z: i64) -> i64 {
    let sunday_based = (z + 4).rem_euclid(7);
    if sunday_based == 0 { 7 } else { sunday_based }
}

pub fn month_key(y: i64, m: i64, _d: i64) -> String {
    format!("{:04}-{:02}", y, m)
}

pub fn week_key(y: i64, m: i64, d: i64) -> String {
    let z = days_from_civil(y, m, d);
    let thursday = z + 4 - iso_weekday(z);
    let (wy, _, _) = civil_from_days(thursday);
    let jan4 = days_from_civil(wy, 1, 4);
    let week = 1 + (thursday - (jan4 - iso_weekday(jan4))) / 7;
    format!("{:04}-W{:02}", wy, week)
}

pub fn period_key(scope: &str, y: i64, m: i64, d: i64) -> String {
    if scope == "week" { week_key(y, m, d) } else { month_key(y, m, d) }
}

pub fn shift_period(scope: &str, key: &str, by: i64) -> String {
    if scope == "month" {
        let mut parts = key.split('-');
        let y: i64 = parts.next().unwrap_or("2026").parse().unwrap_or(2026);
        let m: i64 = parts.next().unwrap_or("1").parse().unwrap_or(1);
        let total = y * 12 + (m - 1) + by;
        let (ny, nm) = (total.div_euclid(12), total.rem_euclid(12) + 1);
        return format!("{:04}-{:02}", ny, nm);
    }
    let mut parts = key.split("-W");
    let y: i64 = parts.next().unwrap_or("2026").parse().unwrap_or(2026);
    let w: i64 = parts.next().unwrap_or("1").parse().unwrap_or(1);
    let jan4 = days_from_civil(y, 1, 4);
    let day = jan4 + (w - 1) * 7 - (iso_weekday(jan4) - 1) + by * 7;
    let (cy, cm, cd) = civil_from_days(day);
    week_key(cy, cm, cd)
}

pub fn period_label(scope: &str, key: &str) -> String {
    if scope == "month" {
        let mut parts = key.split('-');
        let y = parts.next().unwrap_or("");
        let m: usize = parts.next().unwrap_or("1").parse().unwrap_or(1);
        let name = MONTHS.get(m.saturating_sub(1)).copied().unwrap_or("");
        format!("{} {}", name, y)
    } else {
        key.replacen("-W", ", week ", 1)
    }
}

pub fn parse_euro(text: &str) -> Option<i64> {
    let cleaned: String = text.trim().chars().filter(|c| !c.is_whitespace()).collect();
    let normalized = cleaned.replacen(',', ".", 1);
    let mut parts = normalized.split('.');
    let whole = parts.next()?;
    let frac = parts.next();
    if whole.is_empty() || !whole.chars().all(|c| c.is_ascii_digit()) { return None; }
    if parts.next().is_some() { return None; }
    if let Some(f) = frac {
        if f.is_empty() || f.len() > 2 || !f.chars().all(|c| c.is_ascii_digit()) { return None; }
        let mut cents: i64 = whole.parse::<i64>().ok()? * 100;
        cents += if f.len() == 1 { f.parse::<i64>().ok()? * 10 } else { f.parse::<i64>().ok()? };
        Some(cents)
    } else {
        Some(whole.parse::<i64>().ok()? * 100)
    }
}

pub fn format_euro(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let abs = cents.abs();
    format!("{}{},{:02} €", sign, abs / 100, abs % 100)
}

pub fn scale_amount(text: &str, servings: i64, base: i64) -> String {
    if base <= 0 { return text.to_string(); }
    let trimmed = text.trim();
    let end = trimmed.find(|c: char| !(c.is_ascii_digit() || c == ',' || c == '.' || c == ' ')).unwrap_or(trimmed.len());
    let (number_part, rest) = trimmed.split_at(end);
    let cleaned = number_part.trim().replacen(',', ".", 1);
    let value: f64 = match cleaned.parse() { Ok(v) => v, Err(_) => return text.to_string() };
    let scaled = value * servings as f64 / base as f64;
    let number = if (scaled - scaled.round()).abs() < 0.001 {
        format!("{}", scaled.round() as i64)
    } else {
        format!("{:.1}", scaled).replacen('.', ",", 1)
    };
    if rest.trim().is_empty() { number } else { format!("{} {}", number, rest.trim()) }
}

fn parse_date(text: &str) -> Option<(i64, i64, i64)> {
    let mut it = text.split('-');
    let y: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next()?.parse().ok()?;
    let d: i64 = it.next()?.parse().ok()?;
    Some((y, m, d))
}

fn parse_offers(text: &str, store_id: &str, today: &str, source: &str) -> Vec<Value> {
    let (y, m, d) = parse_date(today).unwrap_or((2026, 11, 17));
    let until = days_from_civil(y, m, d) + 7;
    let (ey, em, ed) = civil_from_days(until);
    let valid_to = format!("{:04}-{:02}-{:02}", ey, em, ed);
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim().trim_start_matches(['-', '*', '•']).trim();
        if line.is_empty() { continue; }
        let chars: Vec<char> = line.chars().collect();
        let last_digit = chars.iter().rposition(|c| c.is_ascii_digit());
        let last = match last_digit { Some(i) => i, None => continue };
        let mut start = last;
        while start > 0 && (chars[start - 1].is_ascii_digit() || chars[start - 1] == ',' || chars[start - 1] == '.') { start -= 1; }
        let price_text: String = chars[start..=last].iter().collect();
        let mut product: String = chars[..start].iter().collect::<String>().trim().to_string();
        if let Some(i) = product.find(':') { product = product[i + 1..].trim().to_string(); }
        if product.is_empty() { continue; }
        out.push(json!({
            "storeId": store_id,
            "product": product,
            "price": format!("{} €", price_text.replacen('.', ",", 1)),
            "note": "",
            "validFrom": today,
            "validTo": valid_to,
            "source": source,
            "createdAt": 0,
        }));
    }
    out
}

fn match_store(merchant: &str, stores: &[Value]) -> Option<String> {
    let text = merchant.to_lowercase();
    for store in stores {
        let active = store.get("active").and_then(Value::as_i64).unwrap_or(1);
        if active == 0 { continue; }
        let aliases = store.get("aliases").and_then(Value::as_str).unwrap_or("");
        if aliases.split(',').map(|a| a.trim().to_lowercase()).any(|a| !a.is_empty() && text.contains(&a)) {
            return store.get("id").and_then(Value::as_str).map(str::to_string);
        }
    }
    None
}

fn normalize_meal(meal: &Value) -> Value {
    let mut ingredients = Vec::new();
    for i in 1..=20 {
        let name = meal.get(format!("strIngredient{}", i)).and_then(Value::as_str).unwrap_or("").trim();
        if name.is_empty() { continue; }
        let measure = meal.get(format!("strMeasure{}", i)).and_then(Value::as_str).unwrap_or("").trim();
        ingredients.push(json!({ "name": name, "amount": if measure.is_empty() { "1" } else { measure } }));
    }
    let instructions = meal.get("strInstructions").and_then(Value::as_str).unwrap_or("");
    let steps: Vec<&str> = instructions.lines().map(str::trim).filter(|s| !s.is_empty()).collect();
    let steps = if steps.is_empty() { vec!["Prepare the ingredients, then cook until done."] } else { steps };
    let category = meal.get("strCategory").and_then(Value::as_str).unwrap_or("");
    let area = meal.get("strArea").and_then(Value::as_str).unwrap_or("");
    let summary = if area.is_empty() { category.to_string() } else { format!("{} · {}", area, category) };
    json!({
        "id": meal.get("idMeal").and_then(Value::as_str).unwrap_or(""),
        "title": meal.get("strMeal").and_then(Value::as_str).unwrap_or(""),
        "summary": summary,
        "image": meal.get("strMealThumb").and_then(Value::as_str),
        "category": category,
        "area": area,
        "minutes": 30,
        "servings": 2,
        "ingredients": ingredients,
        "steps": steps,
        "source": "themealdb",
    })
}

fn parse_transaction_csv(text: &str) -> Value {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let delimiter = lines.first().map(|l| {
        if l.contains(';') { ';' } else if l.contains('\t') { '\t' } else { ',' }
    }).unwrap_or(',');
    let mut rows = Vec::new();
    let mut errors = Vec::new();
    for (i, line) in lines.iter().enumerate().skip(1) {
        let parts: Vec<String> = line.split(delimiter).map(|p| p.trim().trim_matches('"').to_string()).collect();
        let date = parts.first().cloned().unwrap_or_default();
        let merchant = parts.get(1).cloned().unwrap_or_default();
        let cents = parts.get(2).and_then(|s| parse_euro(s));
        let valid_date = date.len() == 10 && date.as_bytes()[4] == b'-' && date.as_bytes()[7] == b'-';
        if !valid_date || merchant.is_empty() || cents.is_none() {
            errors.push(format!("Line {}: expected date, merchant, amount", i + 1));
            continue;
        }
        rows.push(json!({
            "date": date,
            "merchant": merchant,
            "amountCents": cents.unwrap().abs(),
            "category": parts.get(3).filter(|s| !s.is_empty()).cloned().unwrap_or_else(|| "uncategorised".to_string()),
            "storeId": Value::Null,
            "source": "csv",
            "externalId": Value::Null,
        }));
    }
    json!({ "rows": rows, "errors": errors })
}

fn store_summary(rows: &[Value], store_id: &str, month: &str) -> Value {
    let matched: Vec<&Value> = rows.iter().filter(|t| {
        t.get("storeId").and_then(Value::as_str) == Some(store_id)
            && t.get("date").and_then(Value::as_str).unwrap_or("").starts_with(month)
    }).collect();
    let total: i64 = matched.iter().map(|t| t.get("amountCents").and_then(Value::as_i64).unwrap_or(0)).sum();
    let visits = matched.len() as i64;
    json!({
        "visits": visits,
        "total": total,
        "average": if visits == 0 { 0 } else { total / visits },
    })
}

pub const SUPERMARKETS_JSON: &str = r#"[
  {"id":"rewe","name":"REWE","aliases":"rewe, rewe markt, rewe center, rewe to go, rewe ebon","active":1},
  {"id":"kaufland","name":"Kaufland","aliases":"kaufland, kaufland card","active":1},
  {"id":"lidl","name":"Lidl","aliases":"lidl, lidl plus, lidl markt","active":1},
  {"id":"aldi","name":"Aldi","aliases":"aldi, aldi nord, aldi sud, aldi süd","active":1},
  {"id":"penny","name":"Penny","aliases":"penny, penny markt","active":1},
  {"id":"netto","name":"Netto","aliases":"netto, netto marken-discount, neto","active":1}
]"#;

/// Lines pasted per brand, e.g. "Milk\nEggs 2\nBread 1".
fn parse_purchases(text: &str, store_id: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for line in text.lines() {
        let clean = line.trim().trim_start_matches(['-', '*', '•']).trim();
        if clean.is_empty() { continue; }
        let parts: Vec<&str> = clean.split_whitespace().collect();
        let (name, qty) = if parts.len() > 1 && parts[parts.len() - 1].chars().all(|c| c.is_ascii_digit()) {
            let q = parts[parts.len() - 1].to_string();
            (parts[..parts.len() - 1].join(" "), q)
        } else {
            (clean.to_string(), "1".to_string())
        };
        out.push(json!({ "storeId": store_id, "name": name, "qty": qty }));
    }
    out
}

/// Build a shopping list from what the user actually buys at each brand.
/// Offers are matched by product name so the UI can mark Angebote.
fn build_list(purchases: &[Value], offers: &[Value], scope: &str) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    for purchase in purchases {
        let name = purchase.get("name").and_then(Value::as_str).unwrap_or("").trim();
        if name.is_empty() { continue; }
        let store = purchase.get("storeId").and_then(Value::as_str).unwrap_or("");
        if let Some(existing) = out.iter_mut().find(|item| {
            item.get("name").and_then(Value::as_str).map(str::to_lowercase) == Some(name.to_lowercase())
                && item.get("store") == purchase.get("storeId")
        }) {
            let current = existing.get("qty").and_then(Value::as_i64).unwrap_or(1);
            let extra = purchase.get("qty").and_then(Value::as_i64).unwrap_or(1);
            let total = if scope == "month" { (current + extra).min(6) } else { current.max(extra) };
            existing["qty"] = json!(total.to_string());
            continue;
        }
        let lower = name.to_lowercase();
        let offer = offers.iter().find(|o| {
            let product = o.get("product").and_then(Value::as_str).unwrap_or("").to_lowercase();
            !product.is_empty() && (lower.contains(&product) || product.contains(&lower))
        });
        out.push(json!({
            "name": name,
            "qty": purchase.get("qty").and_then(Value::as_str).unwrap_or("1"),
            "store": store,
            "offerPrice": offer.and_then(|o| o.get("price")).cloned().unwrap_or(Value::Null),
            "offerProduct": offer.and_then(|o| o.get("product")).cloned().unwrap_or(Value::Null),
        }));
    }
    out
}

fn price_series(prices: &[Value], name: &str, store: &str) -> Vec<Value> {
    let mut rows: Vec<(String, i64)> = prices.iter()
        .filter(|p| {
            p.get("name").and_then(Value::as_str).map(str::to_lowercase) == Some(name.to_lowercase())
                && p.get("storeId").and_then(Value::as_str) == Some(store)
        })
        .filter_map(|p| Some((
            p.get("date").and_then(Value::as_str).unwrap_or("").to_string(),
            p.get("cents").and_then(Value::as_i64).unwrap_or(0),
        )))
        .collect();
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    rows.into_iter().map(|(date, cents)| json!({ "date": date, "cents": cents })).collect()
}

fn price_stats(prices: &[Value], name: &str, store: &str) -> Value {
    let series = price_series(prices, name, store);
    let values: Vec<i64> = series.iter().map(|p| p.get("cents").and_then(Value::as_i64).unwrap_or(0)).collect();
    let current = values.last().copied().unwrap_or(0);
    let min = values.iter().copied().min().unwrap_or(0);
    let max = values.iter().copied().max().unwrap_or(0);
    let avg = if values.is_empty() { 0 } else { values.iter().sum::<i64>() / values.len() as i64 };
    json!({ "current": current, "min": min, "max": max, "avg": avg, "series": series })
}

fn weekday_name(date: &str) -> String {
    let names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let (y, m, d) = parse_date(date).unwrap_or((2026, 11, 17));
    let z = days_from_civil(y, m, d);
    let sunday_based = (z + 4).rem_euclid(7) as usize;
    names[sunday_based].to_string()
}

fn next_weekday(today: &str, target: &str) -> String {
    let names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let target_index = names.iter().position(|n| *n == target).unwrap_or(1);
    let (y, m, d) = parse_date(today).unwrap_or((2026, 11, 17));
    let z = days_from_civil(y, m, d);
    let current = (z + 4).rem_euclid(7) as i64;
    let delta = (target_index as i64 - current).rem_euclid(7);
    let (ny, nm, nd) = civil_from_days(z + delta);
    format!("{:04}-{:02}-{:02}", ny, nm, nd)
}

/// Cheapest weekday from history and the next date it occurs.
fn forecast(prices: &[Value], name: &str, store: &str, today: &str) -> Value {
    let series = price_series(prices, name, store);
    let mut totals: [i64; 7] = [0; 7];
    let mut counts: [i64; 7] = [0; 7];
    for point in &series {
        let date = point.get("date").and_then(Value::as_str).unwrap_or("");
        let cents = point.get("cents").and_then(Value::as_i64).unwrap_or(0);
        let day = weekday_name(date);
        let idx = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
            .iter().position(|n| *n == day).unwrap_or(0);
        totals[idx] += cents;
        counts[idx] += 1;
    }
    let mut best = 1usize;
    let mut best_avg = i64::MAX;
    for i in 0..7 {
        if counts[i] == 0 { continue; }
        let avg = totals[i] / counts[i];
        if avg < best_avg { best_avg = avg; best = i; }
    }
    let weekday = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][best];
    let current = series.last().and_then(|p| p.get("cents").and_then(Value::as_i64)).unwrap_or(0);
    let min = series.iter().filter_map(|p| p.get("cents").and_then(Value::as_i64)).min().unwrap_or(0);
    json!({
        "weekday": weekday,
        "nextDate": next_weekday(today, weekday),
        "expectedCents": best_avg,
        "buyNow": current <= min + 5,
        "samples": counts.iter().sum::<i64>(),
    })
}

/// Pick the cheapest discounter per item from the selected set.
fn optimize(prices: &[Value], items: &[Value], stores: &[String], today: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for item in items {
        let name = item.get("name").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() { continue; }
        let mut best: Option<(String, i64)> = None;
        let mut worst = 0i64;
        for store in stores {
            let series = price_series(prices, name, store);
            let current = series.last().and_then(|p| p.get("cents").and_then(Value::as_i64)).unwrap_or(0);
            if current <= 0 { continue; }
            worst = worst.max(current);
            if best.as_ref().map(|(_, c)| current < *c).unwrap_or(true) { best = Some((store.clone(), current)); }
        }
        if let Some((store, cents)) = best {
            let f = forecast(prices, name, &store, today);
            out.push(json!({
                "name": name,
                "store": store,
                "cents": cents,
                "savings": worst - cents,
                "weekday": f["weekday"],
                "nextDate": f["nextDate"],
                "buyNow": f["buyNow"],
            }));
        }
    }
    out
}

// ---- Money-tracker features --------------------------------------------------------------------

struct Calc<'a> { chars: &'a [u8], pos: usize }

impl<'a> Calc<'a> {
    fn skip(&mut self) { while self.pos < self.chars.len() && self.chars[self.pos] == b' ' { self.pos += 1; } }
    fn expr(&mut self) -> Option<f64> {
        let mut value = self.term()?;
        loop {
            self.skip();
            if self.pos >= self.chars.len() { break; }
            let op = self.chars[self.pos];
            if op != b'+' && op != b'-' { break; }
            self.pos += 1;
            let rhs = self.term()?;
            value = if op == b'+' { value + rhs } else { value - rhs };
        }
        Some(value)
    }
    fn term(&mut self) -> Option<f64> {
        let mut value = self.factor()?;
        loop {
            self.skip();
            if self.pos >= self.chars.len() { break; }
            let op = self.chars[self.pos];
            if op != b'*' && op != b'/' { break; }
            self.pos += 1;
            let rhs = self.factor()?;
            if op == b'/' && rhs == 0.0 { return None; }
            value = if op == b'*' { value * rhs } else { value / rhs };
        }
        Some(value)
    }
    fn factor(&mut self) -> Option<f64> {
        self.skip();
        if self.pos >= self.chars.len() { return None; }
        if self.chars[self.pos] == b'-' {
            self.pos += 1;
            return Some(-self.factor()?);
        }
        if self.chars[self.pos] == b'(' {
            self.pos += 1;
            let value = self.expr()?;
            self.skip();
            if self.pos >= self.chars.len() || self.chars[self.pos] != b')' { return None; }
            self.pos += 1;
            return Some(value);
        }
        let start = self.pos;
        let mut dots = 0;
        while self.pos < self.chars.len() {
            let c = self.chars[self.pos];
            if c.is_ascii_digit() { self.pos += 1; continue; }
            if c == b'.' || c == b',' {
                dots += 1;
                if dots > 1 { return None; }
                self.pos += 1;
                continue;
            }
            break;
        }
        if start == self.pos { return None; }
        let text = std::str::from_utf8(&self.chars[start..self.pos]).ok()?.replace(',', ".");
        text.parse::<f64>().ok()
    }
}

fn evaluate(text: &str) -> Option<i64> {
    let mut calc = Calc { chars: text.as_bytes(), pos: 0 };
    let value = calc.expr()?;
    calc.skip();
    if calc.pos != calc.chars.len() { return None; }
    Some((value * 100.0).round() as i64)
}

fn tx_totals(rows: &[Value], prefix: &str) -> Value {
    let mut income = 0i64;
    let mut expense = 0i64;
    for row in rows {
        let date = row.get("date").and_then(Value::as_str).unwrap_or("");
        if !prefix.is_empty() && !date.starts_with(prefix) { continue; }
        let cents = row.get("amountCents").and_then(Value::as_i64).unwrap_or(0);
        let kind = row.get("kind").and_then(Value::as_str).unwrap_or("expense");
        if kind == "income" { income += cents; } else if kind != "transfer" { expense += cents; }
    }
    json!({ "income": income, "expense": expense, "balance": income - expense })
}

fn category_totals(rows: &[Value], prefix: &str) -> Vec<Value> {
    let mut map: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    for row in rows {
        let date = row.get("date").and_then(Value::as_str).unwrap_or("");
        if !prefix.is_empty() && !date.starts_with(prefix) { continue; }
        let kind = row.get("kind").and_then(Value::as_str).unwrap_or("expense");
        if kind == "income" || kind == "transfer" { continue; }
        let category = row.get("category").and_then(Value::as_str).unwrap_or("uncategorised").to_string();
        *map.entry(category).or_insert(0) += row.get("amountCents").and_then(Value::as_i64).unwrap_or(0);
    }
    let mut out: Vec<Value> = map.into_iter().map(|(category, cents)| json!({ "category": category, "cents": cents })).collect();
    out.sort_by(|a, b| b.get("cents").and_then(Value::as_i64).unwrap_or(0).cmp(&a.get("cents").and_then(Value::as_i64).unwrap_or(0)));
    out
}

fn budget_status(budgets: &[Value], spending: &[Value]) -> Vec<Value> {
    let spent: std::collections::BTreeMap<String, i64> = spending.iter()
        .map(|s| (s.get("category").and_then(Value::as_str).unwrap_or("").to_string(), s.get("cents").and_then(Value::as_i64).unwrap_or(0)))
        .collect();
    budgets.iter().map(|b| {
        let category = b.get("category").and_then(Value::as_str).unwrap_or("");
        let limit = b.get("limitCents").and_then(Value::as_i64).unwrap_or(0);
        let used = spent.get(category).copied().unwrap_or(0);
        json!({
            "category": category,
            "limit": limit,
            "spent": used,
            "remaining": limit - used,
            "percent": if limit == 0 { 0 } else { (used * 100) / limit },
        })
    }).collect()
}

fn next_due(day: i64, today: &str) -> String {
    let (y, m, d) = parse_date(today).unwrap_or((2026, 11, 18));
    let target = day.clamp(1, 28);
    let mut year = y;
    let mut month = m;
    if d > target { month += 1; if month > 12 { month = 1; year += 1; } }
    format!("{:04}-{:02}-{:02}", year, month, target)
}

fn scheduled(rows: &[Value], today: &str) -> Vec<Value> {
    let mut out: Vec<Value> = rows.iter().filter(|r| r.get("active").and_then(Value::as_i64).unwrap_or(1) == 1)
        .map(|r| {
            let day = r.get("dayOfMonth").and_then(Value::as_i64).unwrap_or(1);
            json!({
                "name": r.get("name").cloned().unwrap_or(json!("")),
                "amountCents": r.get("amountCents").cloned().unwrap_or(json!(0)),
                "category": r.get("category").cloned().unwrap_or(json!("")),
                "nextDate": next_due(day, today),
            })
        }).collect();
    out.sort_by(|a, b| a["nextDate"].as_str().unwrap_or("").cmp(b["nextDate"].as_str().unwrap_or("")));
    out
}

fn csv_export(rows: &[Value]) -> String {
    let mut out = String::from("date;merchant;amount;category;kind;account\n");
    for row in rows {
        let field = |key: &str| row.get(key).and_then(Value::as_str).unwrap_or("").replace(';', ",").replace('\n', " ");
        let amount = row.get("amountCents").and_then(Value::as_i64).unwrap_or(0);
        out.push_str(&format!("{};{};{},{};{};{};{}\n", field("date"), field("merchant"), amount / 100, amount % 100, field("category"), field("kind"), field("accountId")));
    }
    out
}

// ---- Remaining money-tracker features ----------------------------------------------------------

fn pin_hash(pin: &str) -> String {
    let mut value: u64 = 1469598103934665603;
    for byte in pin.as_bytes().iter().cycle().take(64) {
        value ^= *byte as u64;
        value = value.wrapping_mul(1099511628211);
    }
    format!("{:016x}", value)
}

fn convert(cents: i64, from: &str, to: &str, rates: &[Value]) -> Option<i64> {
    let rate = |code: &str| -> Option<f64> {
        rates.iter().find(|r| r.get("code").and_then(Value::as_str) == Some(code))
            .and_then(|r| r.get("rate")).and_then(Value::as_f64)
    };
    let from_rate = rate(from)?;
    let to_rate = rate(to)?;
    if from_rate <= 0.0 { return None; }
    Some(((cents as f64) / from_rate * to_rate).round() as i64)
}

fn split_bill(cents: i64, count: i64, mode: &str, shares: &[i64]) -> Vec<i64> {
    if count <= 0 { return Vec::new(); }
    let weights: Vec<f64> = match mode {
        "amount" => shares.iter().take(count as usize).map(|v| *v as f64).collect(),
        "percent" => shares.iter().take(count as usize).map(|v| *v as f64 / 100.0).collect(),
        _ => vec![1.0; count as usize],
    };
    let weights = if weights.len() != count as usize || weights.iter().sum::<f64>() <= 0.0 { vec![1.0; count as usize] } else { weights };
    let total_weight: f64 = weights.iter().sum();
    let mut out: Vec<i64> = weights.iter().map(|w| ((cents as f64) * w / total_weight).floor() as i64).collect();
    let remainder = cents - out.iter().sum::<i64>();
    for i in 0..remainder.min(out.len() as i64) as usize { out[i] += 1; }
    out
}

fn parse_receipt(text: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for line in text.lines() {
        let clean = line.trim();
        if clean.is_empty() { continue; }
        let chars: Vec<char> = clean.chars().collect();
        let last = match chars.iter().rposition(|c| c.is_ascii_digit()) { Some(i) => i, None => continue };
        let mut start = last;
        while start > 0 && (chars[start - 1].is_ascii_digit() || chars[start - 1] == ',' || chars[start - 1] == '.') { start -= 1; }
        let price: String = chars[start..=last].iter().collect();
        let name: String = chars[..start].iter().collect::<String>().trim().to_string();
        if name.is_empty() { continue; }
        let cents = match price.replace(',', ".").parse::<f64>() { Ok(v) => (v * 100.0).round() as i64, Err(_) => continue };
        out.push(json!({ "name": name, "cents": cents }));
    }
    out
}

fn report_csv(rows: &[Value]) -> String {
    csv_export(rows)
}

fn report_html(rows: &[Value], title: &str) -> String {
    let totals = tx_totals(rows, "");
    let categories = category_totals(rows, "");
    let mut html = format!(
        "<!doctype html><html><head><meta charset='utf-8'><title>{}</title><style>body{{font-family:Arial,sans-serif;margin:32px;color:#171A17}}h1{{font-size:24px}}table{{border-collapse:collapse;width:100%}}td,th{{border-bottom:1px solid #E3E8EE;padding:8px;text-align:left}}.num{{text-align:right}}</style></head><body><h1>{}</h1><p>Income {} · Expense {} · Balance {}</p><h2>Categories</h2><table>",
        title, title,
        format_euro(totals["income"].as_i64().unwrap_or(0)),
        format_euro(totals["expense"].as_i64().unwrap_or(0)),
        format_euro(totals["balance"].as_i64().unwrap_or(0)),
    );
    for row in &categories {
        html.push_str(&format!("<tr><td>{}</td><td class='num'>{}</td></tr>",
            row["category"].as_str().unwrap_or(""), format_euro(row["cents"].as_i64().unwrap_or(0))));
    }
    html.push_str("</table><h2>Transactions</h2><table><tr><th>Date</th><th>Merchant</th><th>Category</th><th class='num'>Amount</th></tr>");
    for row in rows {
        html.push_str(&format!("<tr><td>{}</td><td>{}</td><td>{}</td><td class='num'>{}</td></tr>",
            row["date"].as_str().unwrap_or(""), row["merchant"].as_str().unwrap_or(""),
            row["category"].as_str().unwrap_or(""), format_euro(row["amountCents"].as_i64().unwrap_or(0))));
    }
    html.push_str("</table></body></html>");
    html
}

fn due_soon(rows: &[Value], today: &str, days: i64) -> Vec<Value> {
    let (ty, tm, td) = parse_date(today).unwrap_or((2026, 11, 18));
    let from = days_from_civil(ty, tm, td);
    rows.iter().filter(|r| {
        let date = r.get("nextDate").and_then(Value::as_str).unwrap_or("");
        match parse_date(date) { Some((y, m, d)) => { let z = days_from_civil(y, m, d); z >= from && z <= from + days }, None => false }
    }).cloned().collect()
}

fn base64(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let a = chunk[0] as u32;
        let b = chunk.get(1).copied().unwrap_or(0) as u32;
        let c = chunk.get(2).copied().unwrap_or(0) as u32;
        let value = (a << 16) | (b << 8) | c;
        out.push(ALPHABET[((value >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((value >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { ALPHABET[((value >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { ALPHABET[(value & 63) as usize] as char } else { '=' });
    }
    out
}

fn pdf_escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)")
        .chars().filter(|c| !c.is_control() || *c == '\n').collect::<String>()
        .replace('\n', " ")
}

/// Minimal, dependency-free PDF report. Returns base64 so Expo can write or download it.
fn report_pdf_bytes(rows: &[Value], title: &str) -> Vec<u8> {
    let totals = tx_totals(rows, "");
    let categories = category_totals(rows, "");
    let mut lines = vec![
        title.to_string(),
        format!("Income {}", format_euro(totals["income"].as_i64().unwrap_or(0))),
        format!("Expense {}", format_euro(totals["expense"].as_i64().unwrap_or(0))),
        format!("Balance {}", format_euro(totals["balance"].as_i64().unwrap_or(0))),
        String::new(),
        "CATEGORIES".to_string(),
    ];
    for row in &categories {
        lines.push(format!("{}  {}", row["category"].as_str().unwrap_or(""), format_euro(row["cents"].as_i64().unwrap_or(0))));
    }
    lines.push(String::new());
    lines.push("TRANSACTIONS".to_string());
    for row in rows {
        lines.push(format!("{}  {}  {}  {}",
            row["date"].as_str().unwrap_or(""),
            row["merchant"].as_str().unwrap_or(""),
            row["category"].as_str().unwrap_or(""),
            format_euro(row["amountCents"].as_i64().unwrap_or(0)),
        ));
    }

    let mut content = String::from("BT /F1 11 Tf 48 790 Td 15 TL\n");
    for line in &lines {
        content.push_str(&format!("({}) Tj T*\n", pdf_escape(line)));
    }
    content.push_str("ET\n");

    let mut objects: Vec<String> = Vec::new();
    objects.push("<< /Type /Catalog /Pages 2 0 R >>".to_string());
    objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string());
    objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>".to_string());
    objects.push(format!("<< /Length {} >>\nstream\n{}endstream", content.len(), content));
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string());

    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets: Vec<usize> = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{}\nendobj\n", index + 1, object));
    }
    let xref_start = pdf.len();
    pdf.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1));
    for offset in &offsets {
        pdf.push_str(&format!("{:010} 00000 n \n", offset));
    }
    pdf.push_str(&format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF", objects.len() + 1, xref_start));
    pdf.into_bytes()
}

fn report_pdf(rows: &[Value], title: &str) -> String {
    base64(&report_pdf_bytes(rows, title))
}

fn debt_summary(rows: &[Value]) -> Value {
    let total: i64 = rows.iter().map(|r| r.get("totalCents").and_then(Value::as_i64).unwrap_or(0)).sum();
    let paid: i64 = rows.iter().map(|r| r.get("paidCents").and_then(Value::as_i64).unwrap_or(0)).sum();
    json!({ "total": total, "paid": paid, "remaining": total - paid })
}

// ---- Final money-tracker features ---------------------------------------------------------------

fn ledger_balance(entries: &[Value], account: &str) -> i64 {
    entries.iter().filter(|e| e.get("accountId").and_then(Value::as_str) == Some(account))
        .map(|e| {
            let cents = e.get("cents").and_then(Value::as_i64).unwrap_or(0);
            match e.get("side").and_then(Value::as_str).unwrap_or("debit") { "credit" => cents, _ => -cents }
        }).sum()
}

fn ledger_check(entries: &[Value]) -> Value {
    let mut totals: std::collections::BTreeMap<String, (i64, i64)> = std::collections::BTreeMap::new();
    for entry in entries {
        let tx = entry.get("txId").and_then(Value::as_str).unwrap_or("").to_string();
        let cents = entry.get("cents").and_then(Value::as_i64).unwrap_or(0);
        let slot = totals.entry(tx).or_insert((0, 0));
        if entry.get("side").and_then(Value::as_str) == Some("credit") { slot.1 += cents; } else { slot.0 += cents; }
    }
    let problems: Vec<String> = totals.iter().filter(|(_, (d, c))| d != c).map(|(tx, (d, c))| format!("{}: {} vs {}", tx, d, c)).collect();
    json!({ "balanced": problems.is_empty(), "problems": problems })
}

fn goal_status(goals: &[Value]) -> Vec<Value> {
    goals.iter().map(|g| {
        let target = g.get("targetCents").and_then(Value::as_i64).unwrap_or(0);
        let saved = g.get("savedCents").and_then(Value::as_i64).unwrap_or(0);
        let percent = if target == 0 { 0 } else { (saved * 100 / target).min(100) };
        let days_left = g.get("dueDate").and_then(Value::as_str)
            .and_then(|d| parse_date(d))
            .map(|(y, m, d)| days_from_civil(y, m, d) - days_from_civil(2026, 11, 18))
            .unwrap_or(0);
        json!({
            "name": g.get("name").cloned().unwrap_or(json!("")),
            "target": target, "saved": saved,
            "remaining": (target - saved).max(0),
            "percent": percent,
            "daysLeft": days_left,
        })
    }).collect()
}

fn group_categories(rows: &[Value], categories: &[Value], prefix: &str) -> Vec<Value> {
    let parent_of: std::collections::BTreeMap<String, String> = categories.iter()
        .filter_map(|c| {
            let name = c.get("name").and_then(Value::as_str)?;
            let parent = c.get("parent").and_then(Value::as_str).unwrap_or(name);
            Some((name.to_lowercase(), parent.to_string()))
        }).collect();
    let mut totals: std::collections::BTreeMap<String, i64> = std::collections::BTreeMap::new();
    for row in rows {
        let date = row.get("date").and_then(Value::as_str).unwrap_or("");
        if !prefix.is_empty() && !date.starts_with(prefix) { continue; }
        if row.get("kind").and_then(Value::as_str) == Some("income") { continue; }
        let category = row.get("category").and_then(Value::as_str).unwrap_or("uncategorised");
        let root = parent_of.get(&category.to_lowercase()).cloned().unwrap_or_else(|| category.to_string());
        *totals.entry(root).or_insert(0) += row.get("amountCents").and_then(Value::as_i64).unwrap_or(0);
    }
    let mut out: Vec<Value> = totals.into_iter().map(|(category, cents)| json!({ "category": category, "cents": cents })).collect();
    out.sort_by(|a, b| b["cents"].as_i64().unwrap_or(0).cmp(&a["cents"].as_i64().unwrap_or(0)));
    out
}

fn filter_tag(rows: &[Value], tag: &str) -> Vec<Value> {
    let needle = tag.trim().to_lowercase();
    if needle.is_empty() { return rows.to_vec(); }
    rows.iter().filter(|row| {
        row.get("tags").and_then(Value::as_str).unwrap_or("").to_lowercase().split(|c| c == ',' || c == ' ').any(|t| t == needle)
    }).cloned().collect()
}

fn geo_summary(rows: &[Value]) -> Vec<Value> {
    let mut groups: std::collections::BTreeMap<(i64, i64), (i64, i64)> = std::collections::BTreeMap::new();
    for row in rows {
        let lat = match row.get("latitude").and_then(Value::as_f64) { Some(v) => (v * 10.0).round() as i64, None => continue };
        let lng = match row.get("longitude").and_then(Value::as_f64) { Some(v) => (v * 10.0).round() as i64, None => continue };
        let slot = groups.entry((lat, lng)).or_insert((0, 0));
        slot.0 += 1;
        slot.1 += row.get("amountCents").and_then(Value::as_i64).unwrap_or(0);
    }
    let mut out: Vec<Value> = groups.into_iter().map(|((lat, lng), (count, total))| json!({
        "latitude": lat as f64 / 10.0, "longitude": lng as f64 / 10.0, "visits": count, "total": total,
    })).collect();
    out.sort_by(|a, b| b["total"].as_i64().unwrap_or(0).cmp(&a["total"].as_i64().unwrap_or(0)));
    out
}

fn warranty_status(rows: &[Value], today: &str) -> Vec<Value> {
    let (ty, tm, td) = parse_date(today).unwrap_or((2026, 11, 18));
    let now = days_from_civil(ty, tm, td);
    let mut out: Vec<Value> = rows.iter().map(|r| {
        let until = r.get("warrantyUntil").and_then(Value::as_str).unwrap_or("");
        let days_left = parse_date(until).map(|(y, m, d)| days_from_civil(y, m, d) - now);
        json!({
            "name": r.get("merchant").cloned().unwrap_or(json!("")),
            "amountCents": r.get("amountCents").cloned().unwrap_or(json!(0)),
            "warrantyUntil": until,
            "daysLeft": days_left.map(|d| d).unwrap_or(-1),
            "expired": days_left.map(|d| d < 0).unwrap_or(false),
        })
    }).collect();
    out.sort_by(|a, b| a["daysLeft"].as_i64().unwrap_or(0).cmp(&b["daysLeft"].as_i64().unwrap_or(0)));
    out
}

// ---- Period start, XLSX, assistant and shared view ---------------------------------------------

fn period_start_key(y: i64, m: i64, d: i64, start: i64) -> String {
    let start = start.clamp(1, 28);
    let (year, month) = if d < start {
        if m == 1 { (y - 1, 12) } else { (y, m - 1) }
    } else { (y, m) };
    format!("{:04}-{:02}", year, month)
}

fn period_start_shift(key: &str, by: i64) -> String {
    let mut parts = key.split('-');
    let y: i64 = parts.next().unwrap_or("2026").parse().unwrap_or(2026);
    let m: i64 = parts.next().unwrap_or("1").parse().unwrap_or(1);
    let total = y * 12 + (m - 1) + by;
    format!("{:04}-{:02}", total.div_euclid(12), total.rem_euclid(12) + 1)
}

fn period_start_label(key: &str, start: i64) -> String {
    let start = start.clamp(1, 28);
    let mut parts = key.split('-');
    let y: i64 = parts.next().unwrap_or("2026").parse().unwrap_or(2026);
    let m: usize = parts.next().unwrap_or("1").parse().unwrap_or(1);
    let from = MONTHS.get(m.saturating_sub(1)).copied().unwrap_or("");
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    let to = MONTHS.get(nm.saturating_sub(1)).copied().unwrap_or("");
    format!("{} {} – {} {}", from, start, to, start.saturating_sub(1).max(1))
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in data {
        crc ^= *byte as u32;
        for _ in 0..8 { crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 }; }
    }
    !crc
}

fn le16(value: u16) -> [u8; 2] { value.to_le_bytes() }
fn le32(value: u32) -> [u8; 4] { value.to_le_bytes() }

fn zip_store(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    for (name, data) in files {
        let name_bytes = name.as_bytes();
        let checksum = crc32(data);
        let offset = out.len() as u32;
        out.extend_from_slice(&le32(0x04034b50));
        out.extend_from_slice(&le16(20));
        out.extend_from_slice(&le16(0));
        out.extend_from_slice(&le16(0));
        out.extend_from_slice(&le16(0));
        out.extend_from_slice(&le16(0));
        out.extend_from_slice(&le32(checksum));
        out.extend_from_slice(&le32(data.len() as u32));
        out.extend_from_slice(&le32(data.len() as u32));
        out.extend_from_slice(&le16(name_bytes.len() as u16));
        out.extend_from_slice(&le16(0));
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(data);

        central.extend_from_slice(&le32(0x02014b50));
        central.extend_from_slice(&le16(20));
        central.extend_from_slice(&le16(20));
        central.extend_from_slice(&le16(0));
        central.extend_from_slice(&le16(0));
        central.extend_from_slice(&le16(0));
        central.extend_from_slice(&le16(0));
        central.extend_from_slice(&le32(checksum));
        central.extend_from_slice(&le32(data.len() as u32));
        central.extend_from_slice(&le32(data.len() as u32));
        central.extend_from_slice(&le16(name_bytes.len() as u16));
        central.extend_from_slice(&le16(0));
        central.extend_from_slice(&le16(0));
        central.extend_from_slice(&le16(0));
        central.extend_from_slice(&le16(0));
        central.extend_from_slice(&le32(0));
        central.extend_from_slice(&le32(offset));
        central.extend_from_slice(name_bytes);
    }
    let central_offset = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&le32(0x06054b50));
    out.extend_from_slice(&le16(0));
    out.extend_from_slice(&le16(0));
    out.extend_from_slice(&le16(files.len() as u16));
    out.extend_from_slice(&le16(files.len() as u16));
    out.extend_from_slice(&le32(central.len() as u32));
    out.extend_from_slice(&le32(central_offset));
    out.extend_from_slice(&le16(0));
    out
}

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn xlsx_export(rows: &[Value]) -> Vec<u8> {
    let columns = ["Date", "Merchant", "Amount", "Category", "Kind", "Account"];
    let mut sheet = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>");
    sheet.push_str("<row r=\"1\">");
    for (index, label) in columns.iter().enumerate() {
        sheet.push_str(&format!("<c r=\"{}1\" t=\"inlineStr\"><is><t>{}</t></is></c>", (b'A' + index as u8) as char, label));
    }
    sheet.push_str("</row>");
    for (row_index, row) in rows.iter().enumerate() {
        let r = row_index + 2;
        sheet.push_str(&format!("<row r=\"{}\">", r));
        let cents = row.get("amountCents").and_then(Value::as_i64).unwrap_or(0);
        let get = |key: &str| xml_escape(row.get(key).and_then(Value::as_str).unwrap_or(""));
        let values = [
            get("date"), get("merchant"), format!("{},{}", cents / 100, cents % 100),
            get("category"), get("kind"), get("accountId"),
        ];
        for (index, value) in values.iter().enumerate() {
            sheet.push_str(&format!("<c r=\"{}{}\" t=\"inlineStr\"><is><t>{}</t></is></c>", (b'A' + index as u8) as char, r, value));
        }
        sheet.push_str("</row>");
    }
    sheet.push_str("</sheetData></worksheet>");

    let content_types = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>";
    let rels = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>";
    let workbook = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Transactions\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>";
    let workbook_rels = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>";

    let files = vec![
        ("[Content_Types].xml".to_string(), content_types.as_bytes().to_vec()),
        ("_rels/.rels".to_string(), rels.as_bytes().to_vec()),
        ("xl/workbook.xml".to_string(), workbook.as_bytes().to_vec()),
        ("xl/_rels/workbook.xml.rels".to_string(), workbook_rels.as_bytes().to_vec()),
        ("xl/worksheets/sheet1.xml".to_string(), sheet.into_bytes()),
    ];
    zip_store(&files)
}

fn assistant_answer(question: &str, rows: &[Value], budgets: &[Value]) -> String {
    let q = question.to_lowercase();
    let totals = tx_totals(rows, "");
    let categories = category_totals(rows, "");
    if q.contains("biggest") || q.contains("most spent") || q.contains("largest") {
        return match categories.first() {
            Some(row) => format!("Your biggest category is {} at {}.", row["category"].as_str().unwrap_or(""), format_euro(row["cents"].as_i64().unwrap_or(0))),
            None => "No spending recorded yet.".to_string(),
        };
    }
    if q.contains("income") || q.contains("earned") {
        return format!("You recorded {} of income.", format_euro(totals["income"].as_i64().unwrap_or(0)));
    }
    if q.contains("budget") {
        let status = budget_status(budgets, &categories);
        if let Some(category) = status.iter().find(|s| q.contains(&s["category"].as_str().unwrap_or("").to_lowercase())) {
            return format!("Budget for {}: {} spent of {}, {} left ({}%).",
                category["category"].as_str().unwrap_or(""), format_euro(category["spent"].as_i64().unwrap_or(0)),
                format_euro(category["limit"].as_i64().unwrap_or(0)), format_euro(category["remaining"].as_i64().unwrap_or(0)),
                category["percent"].as_i64().unwrap_or(0));
        }
        return format!("You have {} in budgets. Ask about a category, e.g. 'budget groceries'.", status.len());
    }
    if q.contains("average") || q.contains("per day") {
        let days = 30i64;
        return format!("On average you spend {} per day over the last 30 days.", format_euro(totals["expense"].as_i64().unwrap_or(0) / days));
    }
    if q.contains("spend") || q.contains("spent") || q.contains("much") {
        return format!("You spent {} against {} of income; balance is {}.",
            format_euro(totals["expense"].as_i64().unwrap_or(0)), format_euro(totals["income"].as_i64().unwrap_or(0)),
            format_euro(totals["balance"].as_i64().unwrap_or(0)));
    }
    "Ask me about spending, income, your biggest category, or a budget (e.g. 'budget groceries').".to_string()
}

fn combined_summary(own: &[Value], partner: &[Value]) -> Value {
    let a = tx_totals(own, "");
    let b = tx_totals(partner, "");
    json!({
        "ownExpense": a["expense"], "partnerExpense": b["expense"],
        "totalExpense": a["expense"].as_i64().unwrap_or(0) + b["expense"].as_i64().unwrap_or(0),
        "ownIncome": a["income"], "partnerIncome": b["income"],
        "totalIncome": a["income"].as_i64().unwrap_or(0) + b["income"].as_i64().unwrap_or(0),
    })
}

// ---- Integrated app functionality --------------------------------------------------------------

fn paycheck_plan(take_home: i64, rules: &[Value]) -> Vec<Value> {
    let mut out = Vec::new();
    let mut used = 0i64;
    for rule in rules {
        let percent = rule.get("percent").and_then(Value::as_f64).unwrap_or(0.0);
        let fixed = rule.get("cents").and_then(Value::as_i64).unwrap_or(0);
        let cents = if fixed > 0 { fixed } else { ((take_home as f64) * percent / 100.0).round() as i64 };
        let cents = cents.min((take_home - used).max(0));
        used += cents;
        out.push(json!({
            "label": rule.get("label").cloned().unwrap_or(json!("")),
            "cents": cents,
            "kind": rule.get("kind").cloned().unwrap_or(json!("envelope")),
        }));
    }
    out.push(json!({ "label": "Guilt-free", "cents": take_home - used, "kind": "leftover" }));
    out
}

fn checklist_status(goals: &[Value], items: &[Value]) -> Vec<Value> {
    goals.iter().map(|goal| {
        let id = goal.get("id").and_then(Value::as_i64).unwrap_or(0);
        let own: Vec<&Value> = items.iter().filter(|i| i.get("goalId").and_then(Value::as_i64) == Some(id)).collect();
        let done = own.iter().filter(|i| i.get("completed").and_then(Value::as_i64) == Some(1)).count() as i64;
        let plan: i64 = own.iter().map(|i| i.get("amountCents").and_then(Value::as_i64).unwrap_or(0)).sum();
        let paid: i64 = own.iter().filter(|i| i.get("completed").and_then(Value::as_i64) == Some(1))
            .map(|i| i.get("amountCents").and_then(Value::as_i64).unwrap_or(0)).sum();
        json!({ "id": id, "name": goal.get("title").cloned().unwrap_or(json!("")), "done": done, "total": own.len(), "plan": plan, "paid": paid })
    }).collect()
}

fn rollover_status(budgets: &[Value], spending: &[Value]) -> Vec<Value> {
    let spent: std::collections::BTreeMap<String, i64> = spending.iter()
        .map(|s| (s.get("category").and_then(Value::as_str).unwrap_or("").to_string(), s.get("cents").and_then(Value::as_i64).unwrap_or(0)))
        .collect();
    budgets.iter().map(|b| {
        let category = b.get("category").and_then(Value::as_str).unwrap_or("");
        let limit = b.get("limitCents").and_then(Value::as_i64).unwrap_or(0);
        let rollover = b.get("rolloverCents").and_then(Value::as_i64).unwrap_or(0);
        let used = spent.get(category).copied().unwrap_or(0);
        let available = limit + rollover;
        json!({ "category": category, "limit": limit, "rollover": rollover, "spent": used, "available": available, "remaining": available - used })
    }).collect()
}

fn invoice_total(items: &[Value], tax_percent: f64) -> i64 {
    let subtotal: i64 = items.iter().map(|i| {
        let qty = i.get("qty").and_then(Value::as_i64).unwrap_or(1);
        let cents = i.get("cents").and_then(Value::as_i64).unwrap_or(0);
        qty * cents
    }).sum();
    (subtotal as f64 * (1.0 + tax_percent / 100.0)).round() as i64
}

fn valuation_change(rows: &[Value], account: &str) -> i64 {
    let mut values: Vec<(String, i64)> = rows.iter()
        .filter(|r| r.get("accountId").and_then(Value::as_str) == Some(account))
        .map(|r| (r.get("date").and_then(Value::as_str).unwrap_or("").to_string(), r.get("valueCents").and_then(Value::as_i64).unwrap_or(0)))
        .collect();
    values.sort_by(|a, b| a.0.cmp(&b.0));
    match (values.first(), values.last()) {
        (Some((_, first)), Some((_, last))) => last - first,
        _ => 0,
    }
}

fn compare_months(rows: &[Value], current: &str, previous: &str) -> Value {
    let total_for = |prefix: &str| -> i64 {
        rows.iter().filter(|r| r.get("date").and_then(Value::as_str).unwrap_or("").starts_with(prefix)
            && r.get("kind").and_then(Value::as_str) != Some("income"))
            .map(|r| r.get("amountCents").and_then(Value::as_i64).unwrap_or(0)).sum()
    };
    let now = total_for(current);
    let before = total_for(previous);
    let mut categories: std::collections::BTreeMap<String, (i64, i64)> = std::collections::BTreeMap::new();
    for row in rows {
        let date = row.get("date").and_then(Value::as_str).unwrap_or("");
        let category = row.get("category").and_then(Value::as_str).unwrap_or("uncategorised").to_string();
        let cents = row.get("amountCents").and_then(Value::as_i64).unwrap_or(0);
        let slot = categories.entry(category).or_insert((0, 0));
        if date.starts_with(current) { slot.0 += cents; }
        if date.starts_with(previous) { slot.1 += cents; }
    }
    let mut out: Vec<Value> = categories.into_iter().map(|(category, (c, p))| json!({
        "category": category, "current": c, "previous": p,
        "changePercent": if p == 0 { 0.0 } else { ((c - p) as f64) / (p as f64) * 100.0 },
    })).collect();
    out.sort_by(|a, b| b["current"].as_i64().unwrap_or(0).cmp(&a["current"].as_i64().unwrap_or(0)));
    json!({ "current": now, "previous": before, "categories": out })
}

// ---- Remaining upstream features ----------------------------------------------------------------

fn base64_decode(text: &str) -> Vec<u8> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let clean: Vec<u8> = text.bytes().filter(|b| *b != b'=' && !b.is_ascii_whitespace()).collect();
    let mut out = Vec::new();
    for chunk in clean.chunks(4) {
        let mut value = 0u32;
        let mut count: usize = 0;
        for byte in chunk {
            let index = ALPHABET.iter().position(|c| c == byte).unwrap_or(0) as u32;
            value = (value << 6) | index;
            count += 1;
        }
        let bytes = [(value >> 16) as u8, (value >> 8) as u8, value as u8];
        out.extend_from_slice(&bytes[..count.saturating_sub(1).min(3)]);
    }
    out
}

fn unzip_stored(data: &[u8]) -> Option<Vec<(String, Vec<u8>)>> {
    let mut out = Vec::new();
    let mut offset = 0usize;
    while offset + 30 <= data.len() {
        let signature = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?);
        if signature == 0x02014b50 || signature == 0x06054b50 { break; }
        if signature != 0x04034b50 { return None; }
        let method = u16::from_le_bytes(data[offset + 8..offset + 10].try_into().ok()?);
        let size = u32::from_le_bytes(data[offset + 18..offset + 22].try_into().ok()?) as usize;
        let name_len = u16::from_le_bytes(data[offset + 26..offset + 28].try_into().ok()?) as usize;
        let extra_len = u16::from_le_bytes(data[offset + 28..offset + 30].try_into().ok()?) as usize;
        let start = offset + 30 + name_len + extra_len;
        if start + size > data.len() { return None; }
        if method != 0 { return None; }
        let name = String::from_utf8_lossy(&data[offset + 30..offset + 30 + name_len]).to_string();
        out.push((name, data[start..start + size].to_vec()));
        offset = start + size;
    }
    Some(out)
}

fn xml_text(xml: &str) -> String {
    xml.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'")
}

fn xlsx_import(base64_data: &str) -> Vec<Value> {
    let bytes = base64_decode(base64_data);
    let files = match unzip_stored(&bytes) { Some(v) => v, None => return Vec::new() };
    let sheet = match files.iter().find(|(name, _)| name == "xl/worksheets/sheet1.xml") { Some((_, data)) => data, None => return Vec::new() };
    let xml = String::from_utf8_lossy(sheet).to_string();
    let mut rows: Vec<Value> = Vec::new();
    let mut first_row = true;
    let mut rest = xml.as_str();
    while let Some(pos) = rest.find("<row") {
        rest = &rest[pos + 4..];
        let end = match rest.find("</row>") { Some(e) => e, None => break };
        let row_xml = &rest[..end];
        rest = &rest[end + 6..];
        let mut cells: Vec<String> = Vec::new();
        let mut cell_rest = row_xml;
        while let Some(tpos) = cell_rest.find("<t") {
            cell_rest = &cell_rest[tpos + 2..];
            let open_end = match cell_rest.find('>') { Some(e) => e, None => break };
            cell_rest = &cell_rest[open_end + 1..];
            let close = match cell_rest.find("</t>") { Some(e) => e, None => break };
            cells.push(xml_text(&cell_rest[..close]));
            cell_rest = &cell_rest[close + 4..];
        }
        if first_row { first_row = false; continue; }
        if cells.len() < 4 { continue; }
        let amount = cells[2].replace(",", ".").parse::<f64>().unwrap_or(0.0);
        rows.push(json!({
            "date": cells[0], "merchant": cells[1], "amountCents": (amount * 100.0).round() as i64,
            "category": cells[3], "kind": cells.get(4).cloned().unwrap_or_else(|| "expense".to_string()),
        }));
    }
    rows
}

fn chat_command(text: &str) -> Value {
    let parts: Vec<&str> = text.trim().split_whitespace().collect();
    let command = parts.first().copied().unwrap_or("").to_lowercase();
    if command == "/undo" { return json!({ "command": "undo", "kind": "expense", "cents": 0, "category": "", "merchant": "" }); }
    if parts.len() < 3 { return json!({ "command": command, "kind": "unknown", "cents": 0, "category": "", "merchant": "" }); }
    let cents = parse_euro(parts[1]).unwrap_or(0);
    let category = parts[2].to_string();
    let merchant = parts.get(3).copied().unwrap_or(&parts[2]).to_string();
    let kind = if command == "/income" { "income" } else { "expense" };
    json!({ "command": command, "kind": kind, "cents": cents, "category": category, "merchant": merchant })
}

fn gold_profit(grams: f64, buyCents: i64, currentCents: i64) -> Value {
    let cost = (grams * buyCents as f64).round() as i64;
    let value = (grams * currentCents as f64).round() as i64;
    json!({ "cost": cost, "value": value, "profit": value - cost })
}

fn receivable_status(rows: &[Value], today: &str) -> Vec<Value> {
    let (ty, tm, td) = parse_date(today).unwrap_or((2026, 11, 18));
    let now = days_from_civil(ty, tm, td);
    rows.iter().map(|r| {
        let total = r.get("totalCents").and_then(Value::as_i64).unwrap_or(0);
        let paid = r.get("paidCents").and_then(Value::as_i64).unwrap_or(0);
        let due = r.get("dueDate").and_then(Value::as_str).unwrap_or("");
        let overdue = parse_date(due).map(|(y, m, d)| days_from_civil(y, m, d) < now).unwrap_or(false);
        json!({ "name": r.get("name").cloned().unwrap_or(json!("")), "remaining": total - paid, "dueDate": due, "overdue": overdue })
    }).collect()
}

fn subscription_next(rows: &[Value], today: &str) -> Vec<Value> {
    rows.iter().map(|r| {
        let interval = r.get("interval").and_then(Value::as_str).unwrap_or("monthly");
        let start = r.get("startDate").and_then(Value::as_str).unwrap_or(today);
        let (y, m, d) = parse_date(start).unwrap_or((2026, 11, 18));
        let next = if interval == "weekly" {
            let day = y * 365 + m * 30 + d;
            let (ny, nm, nd) = civil_from_days(day + 7);
            format!("{:04}-{:02}-{:02}", ny, nm, nd)
        } else {
            let nm = if m == 12 { 1 } else { m + 1 };
            let ny = if m == 12 { y + 1 } else { y };
            format!("{:04}-{:02}-{:02}", ny, nm, d.min(28))
        };
        json!({ "name": r.get("name").cloned().unwrap_or(json!("")), "amountCents": r.get("amountCents").cloned().unwrap_or(json!(0)), "interval": interval, "nextDate": next })
    }).collect()
}

fn project_funding(items: &[Value], available: i64) -> Value {
    let mut remaining = available;
    let mut out = Vec::new();
    for item in items {
        let cents = item.get("cents").and_then(Value::as_i64).unwrap_or(0);
        let funded = remaining >= cents;
        if funded { remaining -= cents; }
        out.push(json!({ "name": item.get("name").cloned().unwrap_or(json!("")), "cents": cents, "funded": funded }));
    }
    json!({ "items": out, "unused": remaining })
}

fn bill_confirm(bill_cents: i64, paid_cents: i64) -> Value {
    let difference = paid_cents - bill_cents;
    json!({
        "difference": difference,
        "overage": difference.max(0),
        "shortfall": (-difference).max(0),
        "recoveryPlan": if difference < 0 { "Create a recovery plan for the shortfall." } else { "No recovery needed." },
    })
}

fn credit_payoff(balance_cents: i64, monthly_cents: i64, apr_percent: f64) -> Value {
    if monthly_cents <= 0 { return json!({ "months": 0, "interest": 0 }); }
    let monthly_rate = apr_percent / 100.0 / 12.0;
    let mut balance = balance_cents as f64;
    let mut months = 0i64;
    let mut interest = 0i64;
    while balance > 0.0 && months < 600 {
        let month_interest = balance * monthly_rate;
        interest += month_interest.round() as i64;
        balance = balance + month_interest - monthly_cents as f64;
        months += 1;
    }
    json!({ "months": months, "interest": interest })
}

fn paycheck_history(paychecks: &[Value], allocations: &[Value]) -> Vec<Value> {
    paychecks.iter().map(|p| {
        let id = p.get("id").and_then(Value::as_i64).unwrap_or(0);
        let planned: i64 = allocations.iter().filter(|a| a.get("paycheckId").and_then(Value::as_i64) == Some(id))
            .map(|a| a.get("cents").and_then(Value::as_i64).unwrap_or(0)).sum();
        json!({
            "date": p.get("date").cloned().unwrap_or(json!("")),
            "takeHome": p.get("takeHomeCents").cloned().unwrap_or(json!(0)),
            "planned": planned,
            "guiltFree": p.get("takeHomeCents").and_then(Value::as_i64).unwrap_or(0) - planned,
        })
    }).collect()
}

// ---- Final parity gaps --------------------------------------------------------------------------

fn spending_summary(rows: &[Value], locale: &str) -> String {
    let totals = tx_totals(rows, "");
    let categories = category_totals(rows, "");
    let expense = totals["expense"].as_i64().unwrap_or(0);
    let top = categories.first();
    let label = if locale == "de" { "Ausgaben" } else { "spending" };
    match top {
        Some(row) => format!("Total {}: {} · biggest category {} ({}) · {} categories used",
            label, format_euro(expense), row["category"].as_str().unwrap_or(""),
            format_euro(row["cents"].as_i64().unwrap_or(0)), categories.len()),
        None => format!("No {} recorded yet.", label),
    }
}

fn paycheck_dates(start: &str, frequency: &str, count: i64) -> Vec<String> {
    let (y, m, d) = parse_date(start).unwrap_or((2026, 11, 18));
    let z = days_from_civil(y, m, d);
    let step = match frequency { "weekly" => 7, "biweekly" => 14, "semimonthly" => 15, _ => 30 };
    (0..count.max(1)).map(|i| {
        let (cy, cm, cd) = civil_from_days(z + i * step);
        format!("{:04}-{:02}-{:02}", cy, cm, cd)
    }).collect()
}

fn paycheck_proration(amount_cents: i64, frequency: &str) -> i64 {
    match frequency { "weekly" => (amount_cents as f64 / 52.0 * 12.0).round() as i64,
        "biweekly" => (amount_cents as f64 / 26.0 * 12.0).round() as i64,
        "semimonthly" => (amount_cents as f64 / 24.0 * 12.0).round() as i64,
        _ => amount_cents }
}

fn schedule_recurring(rows: &[Value], today: &str, count: i64) -> Vec<Value> {
    let (y, m, d) = parse_date(today).unwrap_or((2026, 11, 18));
    let z = days_from_civil(y, m, d);
    let mut out = Vec::new();
    for row in rows {
        let start = row.get("startDate").and_then(Value::as_str).unwrap_or(today);
        let (sy, sm, sd) = parse_date(start).unwrap_or((y, m, d));
        let frequency = row.get("frequency").and_then(Value::as_str).unwrap_or("monthly");
        let step = match frequency { "weekly" => 7, "biweekly" => 14, "semimonthly" => 15, _ => 30 };
        let limit = row.get("count").and_then(Value::as_i64).unwrap_or(count);
        let mut generated = 0;
        let mut cursor = days_from_civil(sy, sm, sd);
        while cursor < z && generated < limit { cursor += step; generated += 1; }
        let mut dates = Vec::new();
        while generated < limit && (dates.len() as i64) < count {
            let (cy, cm, cd) = civil_from_days(cursor);
            dates.push(format!("{:04}-{:02}-{:02}", cy, cm, cd));
            cursor += step; generated += 1;
        }
        out.push(json!({ "name": row.get("name").cloned().unwrap_or(json!("")), "dates": dates }));
    }
    out
}

// ---- WebAssembly surface (Expo calls these) ----------------------------------------------------

#[wasm_bindgen]
pub fn wasm_period_key(scope: &str, y: i64, m: i64, d: i64) -> String { period_key(scope, y, m, d) }
#[wasm_bindgen]
pub fn wasm_shift_period(scope: &str, key: &str, by: i64) -> String { shift_period(scope, key, by) }
#[wasm_bindgen]
pub fn wasm_period_label(scope: &str, key: &str) -> String { period_label(scope, key) }
#[wasm_bindgen]
pub fn wasm_parse_euro(text: &str) -> Option<i64> { parse_euro(text) }
#[wasm_bindgen]
pub fn wasm_format_euro(cents: i64) -> String { format_euro(cents) }
#[wasm_bindgen]
pub fn wasm_scale_amount(amount: &str, servings: i64, base: i64) -> String { scale_amount(amount, servings, base) }
#[wasm_bindgen]
pub fn wasm_supermarkets() -> String { SUPERMARKETS_JSON.to_string() }
#[wasm_bindgen]
pub fn wasm_match_store(merchant: &str, stores_json: &str) -> Option<String> {
    let stores: Vec<Value> = serde_json::from_str(stores_json).unwrap_or_default();
    match_store(merchant, &stores)
}
#[wasm_bindgen]
pub fn wasm_parse_offers(text: &str, store_id: &str, today: &str, source: &str) -> String {
    serde_json::to_string(&parse_offers(text, store_id, today, source)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_normalize_meal(meal_json: &str) -> String {
    let meal: Value = serde_json::from_str(meal_json).unwrap_or(json!({}));
    serde_json::to_string(&normalize_meal(&meal)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_parse_transaction_csv(text: &str) -> String {
    serde_json::to_string(&parse_transaction_csv(text)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_spending_summary(rows_json: &str, locale: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    spending_summary(&rows, locale)
}
#[wasm_bindgen]
pub fn wasm_paycheck_dates(start: &str, frequency: &str, count: i64) -> String {
    serde_json::to_string(&paycheck_dates(start, frequency, count)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_paycheck_proration(amount_cents: i64, frequency: &str) -> i64 {
    paycheck_proration(amount_cents, frequency)
}
#[wasm_bindgen]
pub fn wasm_schedule_recurring(rows_json: &str, today: &str, count: i64) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&schedule_recurring(&rows, today, count)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_xlsx_import(base64_data: &str) -> String {
    serde_json::to_string(&xlsx_import(base64_data)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_chat_command(text: &str) -> String {
    serde_json::to_string(&chat_command(text)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_gold_profit(grams: f64, buy_cents: i64, current_cents: i64) -> String {
    serde_json::to_string(&gold_profit(grams, buy_cents, current_cents)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_receivable_status(rows_json: &str, today: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&receivable_status(&rows, today)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_subscription_next(rows_json: &str, today: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&subscription_next(&rows, today)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_project_funding(items_json: &str, available: i64) -> String {
    let items: Vec<Value> = serde_json::from_str(items_json).unwrap_or_default();
    serde_json::to_string(&project_funding(&items, available)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_bill_confirm(bill_cents: i64, paid_cents: i64) -> String {
    serde_json::to_string(&bill_confirm(bill_cents, paid_cents)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_credit_payoff(balance_cents: i64, monthly_cents: i64, apr_percent: f64) -> String {
    serde_json::to_string(&credit_payoff(balance_cents, monthly_cents, apr_percent)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_paycheck_history(paychecks_json: &str, allocations_json: &str) -> String {
    let paychecks: Vec<Value> = serde_json::from_str(paychecks_json).unwrap_or_default();
    let allocations: Vec<Value> = serde_json::from_str(allocations_json).unwrap_or_default();
    serde_json::to_string(&paycheck_history(&paychecks, &allocations)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_paycheck_plan(take_home: i64, rules_json: &str) -> String {
    let rules: Vec<Value> = serde_json::from_str(rules_json).unwrap_or_default();
    serde_json::to_string(&paycheck_plan(take_home, &rules)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_checklist_status(goals_json: &str, items_json: &str) -> String {
    let goals: Vec<Value> = serde_json::from_str(goals_json).unwrap_or_default();
    let items: Vec<Value> = serde_json::from_str(items_json).unwrap_or_default();
    serde_json::to_string(&checklist_status(&goals, &items)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_rollover_status(budgets_json: &str, spending_json: &str) -> String {
    let budgets: Vec<Value> = serde_json::from_str(budgets_json).unwrap_or_default();
    let spending: Vec<Value> = serde_json::from_str(spending_json).unwrap_or_default();
    serde_json::to_string(&rollover_status(&budgets, &spending)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_invoice_total(items_json: &str, tax_percent: f64) -> i64 {
    let items: Vec<Value> = serde_json::from_str(items_json).unwrap_or_default();
    invoice_total(&items, tax_percent)
}
#[wasm_bindgen]
pub fn wasm_valuation_change(rows_json: &str, account: &str) -> i64 {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    valuation_change(&rows, account)
}
#[wasm_bindgen]
pub fn wasm_compare_months(rows_json: &str, current: &str, previous: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&compare_months(&rows, current, previous)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_period_start_key(y: i64, m: i64, d: i64, start: i64) -> String { period_start_key(y, m, d, start) }
#[wasm_bindgen]
pub fn wasm_period_start_shift(key: &str, by: i64) -> String { period_start_shift(key, by) }
#[wasm_bindgen]
pub fn wasm_period_start_label(key: &str, start: i64) -> String { period_start_label(key, start) }
#[wasm_bindgen]
pub fn wasm_xlsx(rows_json: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    base64(&xlsx_export(&rows))
}
#[wasm_bindgen]
pub fn wasm_assistant(question: &str, rows_json: &str, budgets_json: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    let budgets: Vec<Value> = serde_json::from_str(budgets_json).unwrap_or_default();
    assistant_answer(question, &rows, &budgets)
}
#[wasm_bindgen]
pub fn wasm_combined_summary(own_json: &str, partner_json: &str) -> String {
    let own: Vec<Value> = serde_json::from_str(own_json).unwrap_or_default();
    let partner: Vec<Value> = serde_json::from_str(partner_json).unwrap_or_default();
    serde_json::to_string(&combined_summary(&own, &partner)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_ledger_balance(entries_json: &str, account: &str) -> i64 {
    let entries: Vec<Value> = serde_json::from_str(entries_json).unwrap_or_default();
    ledger_balance(&entries, account)
}
#[wasm_bindgen]
pub fn wasm_ledger_check(entries_json: &str) -> String {
    let entries: Vec<Value> = serde_json::from_str(entries_json).unwrap_or_default();
    serde_json::to_string(&ledger_check(&entries)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_goal_status(goals_json: &str) -> String {
    let goals: Vec<Value> = serde_json::from_str(goals_json).unwrap_or_default();
    serde_json::to_string(&goal_status(&goals)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_group_categories(rows_json: &str, categories_json: &str, prefix: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    let categories: Vec<Value> = serde_json::from_str(categories_json).unwrap_or_default();
    serde_json::to_string(&group_categories(&rows, &categories, prefix)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_filter_tag(rows_json: &str, tag: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&filter_tag(&rows, tag)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_geo_summary(rows_json: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&geo_summary(&rows)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_warranty_status(rows_json: &str, today: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&warranty_status(&rows, today)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_pin_hash(pin: &str) -> String { pin_hash(pin) }
#[wasm_bindgen]
pub fn wasm_convert(cents: i64, from: &str, to: &str, rates_json: &str) -> Option<i64> {
    let rates: Vec<Value> = serde_json::from_str(rates_json).unwrap_or_default();
    convert(cents, from, to, &rates)
}
#[wasm_bindgen]
pub fn wasm_split_bill(cents: i64, count: i64, mode: &str, shares_json: &str) -> String {
    let shares: Vec<i64> = serde_json::from_str(shares_json).unwrap_or_default();
    serde_json::to_string(&split_bill(cents, count, mode, &shares)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_parse_receipt(text: &str) -> String {
    serde_json::to_string(&parse_receipt(text)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_report_csv(rows_json: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    report_csv(&rows)
}
#[wasm_bindgen]
pub fn wasm_report_pdf(rows_json: &str, title: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    report_pdf(&rows, title)
}
#[wasm_bindgen]
pub fn wasm_report_html(rows_json: &str, title: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    report_html(&rows, title)
}
#[wasm_bindgen]
pub fn wasm_due_soon(rows_json: &str, today: &str, days: i64) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&due_soon(&rows, today, days)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_debt_summary(rows_json: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&debt_summary(&rows)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_eval(text: &str) -> Option<i64> { evaluate(text) }
#[wasm_bindgen]
pub fn wasm_tx_totals(rows_json: &str, prefix: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&tx_totals(&rows, prefix)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_category_totals(rows_json: &str, prefix: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&category_totals(&rows, prefix)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_budget_status(budgets_json: &str, spending_json: &str) -> String {
    let budgets: Vec<Value> = serde_json::from_str(budgets_json).unwrap_or_default();
    let spending: Vec<Value> = serde_json::from_str(spending_json).unwrap_or_default();
    serde_json::to_string(&budget_status(&budgets, &spending)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_scheduled(rows_json: &str, today: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&scheduled(&rows, today)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_csv_export(rows_json: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    csv_export(&rows)
}
#[wasm_bindgen]
pub fn wasm_price_stats(prices_json: &str, name: &str, store: &str) -> String {
    let prices: Vec<Value> = serde_json::from_str(prices_json).unwrap_or_default();
    serde_json::to_string(&price_stats(&prices, name, store)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_forecast(prices_json: &str, name: &str, store: &str, today: &str) -> String {
    let prices: Vec<Value> = serde_json::from_str(prices_json).unwrap_or_default();
    serde_json::to_string(&forecast(&prices, name, store, today)).unwrap_or_else(|_| "{}".to_string())
}
#[wasm_bindgen]
pub fn wasm_optimize(prices_json: &str, items_json: &str, stores_json: &str, today: &str) -> String {
    let prices: Vec<Value> = serde_json::from_str(prices_json).unwrap_or_default();
    let items: Vec<Value> = serde_json::from_str(items_json).unwrap_or_default();
    let stores: Vec<String> = serde_json::from_str(stores_json).unwrap_or_default();
    serde_json::to_string(&optimize(&prices, &items, &stores, today)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_parse_purchases(text: &str, store_id: &str) -> String {
    serde_json::to_string(&parse_purchases(text, store_id)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_build_list(purchases_json: &str, offers_json: &str, scope: &str) -> String {
    let purchases: Vec<Value> = serde_json::from_str(purchases_json).unwrap_or_default();
    let offers: Vec<Value> = serde_json::from_str(offers_json).unwrap_or_default();
    serde_json::to_string(&build_list(&purchases, &offers, scope)).unwrap_or_else(|_| "[]".to_string())
}
#[wasm_bindgen]
pub fn wasm_store_summary(rows_json: &str, store_id: &str, month: &str) -> String {
    let rows: Vec<Value> = serde_json::from_str(rows_json).unwrap_or_default();
    serde_json::to_string(&store_summary(&rows, store_id, month)).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money() {
        assert_eq!(parse_euro("5,50"), Some(550));
        assert_eq!(parse_euro("12.5"), Some(1250));
        assert_eq!(parse_euro("abc"), None);
        assert_eq!(format_euro(1250), "12,50 €");
        assert_eq!(scale_amount("200 g", 4, 2), "400 g");
    }

    #[test]
    fn periods() {
        assert_eq!(month_key(2026, 11, 17), "2026-11");
        assert_eq!(week_key(2026, 11, 17), "2026-W47");
        assert_eq!(shift_period("month", "2026-01", -1), "2025-12");
        assert_eq!(period_label("month", "2026-11"), "November 2026");
        assert!(period_key("week", 2026, 11, 17).starts_with("2026-W"));
    }

    #[test]
    fn csv() {
        let parsed = parse_transaction_csv("date;merchant;amount\n2026-11-02;REWE;12,40\n2026-11-03;Lidl;8.99\n");
        let v: Value = serde_json::from_str(&serde_json::to_string(&parsed).unwrap()).unwrap();
        assert_eq!(v["rows"].as_array().unwrap().len(), 2);
        assert_eq!(v["rows"][0]["amountCents"], 1240);
        assert_eq!(v["errors"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn stores_and_offers() {
        let stores: Vec<Value> = serde_json::from_str(SUPERMARKETS_JSON).unwrap();
        assert_eq!(match_store("REWE Markt", &stores), Some("rewe".to_string()));
        assert_eq!(match_store("Netto Marken-Discount", &stores), Some("netto".to_string()));
        assert_eq!(match_store("Unknown", &stores), None);
        let offers = parse_offers("Milch 1,29 €\nJoghurt 0,99", "lidl", "2026-11-17", "paste");
        assert_eq!(offers.len(), 2);
        assert_eq!(offers[0]["price"], "1,29 €");
    }

    #[test]
    fn final_parity_gaps() {
        let rows: Vec<Value> = serde_json::from_value(json!([
            {"date":"2026-11-02","category":"Food","amountCents":2040,"kind":"expense"}
        ])).unwrap();
        assert!(spending_summary(&rows, "en").contains("Food"));
        assert!(spending_summary(&rows, "de").contains("Ausgaben"));
        assert_eq!(paycheck_dates("2026-11-02", "weekly", 3).len(), 3);
        assert!(paycheck_proration(120000, "biweekly") < 120000);
        let rec: Vec<Value> = serde_json::from_value(json!([
            {"name":"Rent","startDate":"2026-11-01","frequency":"monthly","count":12}
        ])).unwrap();
        assert_eq!(schedule_recurring(&rec, "2026-11-18", 2)[0]["dates"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn upstream_features() {
        let rows: Vec<Value> = serde_json::from_value(json!([
            {"date":"2026-11-02","merchant":"REWE","category":"Groceries","amountCents":2040,"kind":"expense"}
        ])).unwrap();
        let encoded = base64(&xlsx_export(&rows));
        let imported = xlsx_import(&encoded);
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0]["amountCents"], 2040);
        let cmd = chat_command("/add 12,50 Food Lidl");
        assert_eq!(cmd["cents"], 1250);
        assert_eq!(cmd["merchant"], "Lidl");
        assert_eq!(gold_profit(2.0, 5000, 6000)["profit"], 2000);
        let receivables: Vec<Value> = serde_json::from_value(json!([
            {"name":"Loan","totalCents":100000,"paidCents":30000,"dueDate":"2026-11-01"}
        ])).unwrap();
        assert_eq!(receivable_status(&receivables, "2026-11-18")[0]["remaining"], 70000);
        let subs: Vec<Value> = serde_json::from_value(json!([
            {"name":"Netflix","amountCents":1200,"interval":"monthly","startDate":"2026-11-01"}
        ])).unwrap();
        assert!(subscription_next(&subs, "2026-11-18")[0]["nextDate"].as_str().unwrap().starts_with("2026-12"));
        let items: Vec<Value> = serde_json::from_value(json!([{"name":"Part","cents":3000},{"name":"Tool","cents":5000}])).unwrap();
        assert_eq!(project_funding(&items, 4000)["unused"], 1000);
        assert_eq!(bill_confirm(10000, 12000)["overage"], 2000);
        let payoff = credit_payoff(100000, 10000, 18.0);
        assert!(payoff["months"].as_i64().unwrap() > 10);
        let pays: Vec<Value> = serde_json::from_value(json!([{"id":1,"date":"2026-11-01","takeHomeCents":200000}])).unwrap();
        let allocs: Vec<Value> = serde_json::from_value(json!([{"paycheckId":1,"cents":50000}])).unwrap();
        assert_eq!(paycheck_history(&pays, &allocs)[0]["guiltFree"], 150000);
    }

    #[test]
    fn integrated_app_logic() {
        let rules: Vec<Value> = serde_json::from_value(json!([
            {"label":"Bills","kind":"fixed","cents":90000},
            {"label":"Envelopes","kind":"envelope","percent":20},
            {"label":"Plans","kind":"plan","percent":10}
        ])).unwrap();
        let plan = paycheck_plan(200000, &rules);
        assert_eq!(plan.len(), 4);
        assert_eq!(plan[0]["cents"], 90000);
        assert_eq!(plan[3]["label"], "Guilt-free");
        let goals: Vec<Value> = serde_json::from_value(json!([{"id":1,"title":"Holiday"}])).unwrap();
        let items: Vec<Value> = serde_json::from_value(json!([
            {"goalId":1,"amountCents":1000,"completed":1},
            {"goalId":1,"amountCents":2000,"completed":0}
        ])).unwrap();
        let status = checklist_status(&goals, &items);
        assert_eq!(status[0]["done"], 1);
        assert_eq!(status[0]["paid"], 1000);
        let budgets: Vec<Value> = serde_json::from_value(json!([{"category":"Food","limitCents":20000,"rolloverCents":3000}])).unwrap();
        let spend: Vec<Value> = serde_json::from_value(json!([{"category":"Food","cents":22000}])).unwrap();
        let rolled = rollover_status(&budgets, &spend);
        assert_eq!(rolled[0]["available"], 23000);
        assert_eq!(rolled[0]["remaining"], 1000);
        let items: Vec<Value> = serde_json::from_value(json!([{"qty":2,"cents":1000},{"qty":1,"cents":500}])).unwrap();
        assert_eq!(invoice_total(&items, 19.0), 2975);
        let values: Vec<Value> = serde_json::from_value(json!([
            {"accountId":"bank","date":"2026-10-01","valueCents":100000},
            {"accountId":"bank","date":"2026-11-01","valueCents":112000}
        ])).unwrap();
        assert_eq!(valuation_change(&values, "bank"), 12000);
        let rows: Vec<Value> = serde_json::from_value(json!([
            {"date":"2026-11-02","category":"Food","amountCents":1000,"kind":"expense"},
            {"date":"2026-10-02","category":"Food","amountCents":800,"kind":"expense"}
        ])).unwrap();
        let cmp = compare_months(&rows, "2026-11", "2026-10");
        assert_eq!(cmp["current"], 1000);
        assert_eq!(cmp["categories"][0]["previous"], 800);
    }

    #[test]
    fn period_start_xlsx_assistant_and_shared() {
        assert_eq!(period_start_key(2026, 11, 17, 18), "2026-10");
        assert_eq!(period_start_key(2026, 11, 18, 18), "2026-11");
        assert_eq!(period_start_shift("2026-11", -1), "2026-10");
        assert!(period_start_label("2026-11", 18).contains("18"));
        let rows: Vec<Value> = serde_json::from_value(json!([
            {"date":"2026-11-02","merchant":"REWE","category":"Groceries","amountCents":2040,"kind":"expense"}
        ])).unwrap();
        let zip = xlsx_export(&rows);
        assert_eq!(&zip[0..2], b"PK");
        assert!(String::from_utf8_lossy(&zip).contains("workbook.xml"));
        let budgets: Vec<Value> = serde_json::from_value(json!([{"category":"Groceries","limitCents":3000}])).unwrap();
        assert!(assistant_answer("what did I spend", &rows, &budgets).contains("20,40 €"));
        assert!(assistant_answer("budget groceries", &rows, &budgets).contains("left"));
        let partner: Vec<Value> = serde_json::from_value(json!([
            {"date":"2026-11-03","merchant":"Lidl","category":"Groceries","amountCents":1000,"kind":"expense"}
        ])).unwrap();
        assert_eq!(combined_summary(&rows, &partner)["totalExpense"], 3040);
    }

    #[test]
    fn final_money_features() {
        let entries: Vec<Value> = serde_json::from_value(json!([
            {"txId":"t1","accountId":"bank","side":"credit","cents":1000},
            {"txId":"t1","accountId":"cash","side":"debit","cents":1000},
            {"txId":"t2","accountId":"bank","side":"debit","cents":500}
        ])).unwrap();
        assert_eq!(ledger_balance(&entries, "bank"), 500);
        assert_eq!(ledger_check(&entries)["balanced"], false);
        let goals: Vec<Value> = serde_json::from_value(json!([
            {"name":"Holiday","targetCents":100000,"savedCents":25000,"dueDate":"2027-01-01"}
        ])).unwrap();
        let status = goal_status(&goals);
        assert_eq!(status[0]["percent"], 25);
        let cats: Vec<Value> = serde_json::from_value(json!([{"name":"Coffee","parent":"Leisure"}])).unwrap();
        let rows: Vec<Value> = serde_json::from_value(json!([
            {"date":"2026-11-02","category":"Coffee","amountCents":350,"kind":"expense","tags":"daily,office","latitude":52.5,"longitude":13.4}
        ])).unwrap();
        let grouped = group_categories(&rows, &cats, "");
        assert_eq!(grouped[0]["category"], "Leisure");
        assert_eq!(filter_tag(&rows, "office").len(), 1);
        assert_eq!(geo_summary(&rows)[0]["visits"], 1);
        let receipts: Vec<Value> = serde_json::from_value(json!([
            {"merchant":"MediaMarkt","amountCents":99900,"warrantyUntil":"2026-11-20"}
        ])).unwrap();
        let w = warranty_status(&receipts, "2026-11-18");
        assert_eq!(w[0]["daysLeft"], 2);
        assert_eq!(w[0]["expired"], false);
    }

    #[test]
    fn remaining_money_features() {
        assert_eq!(pin_hash("1234"), pin_hash("1234"));
        assert_ne!(pin_hash("1234"), pin_hash("1235"));
        let rates = json!([{"code":"EUR","rate":1.0},{"code":"USD","rate":1.1}]);
        let rates: Vec<Value> = serde_json::from_value(rates).unwrap();
        assert_eq!(convert(1100, "USD", "EUR", &rates), Some(1000));
        assert_eq!(split_bill(1000, 3, "equal", &[]), vec![334, 333, 333]);
        assert_eq!(split_bill(1000, 2, "percent", &[70, 30]), vec![700, 300]);
        let receipt = parse_receipt("Milk 1,29\nBread 2,50");
        assert_eq!(receipt.len(), 2);
        assert_eq!(receipt[0]["cents"], 129);
        let rows: Vec<Value> = serde_json::from_value(json!([
            {"date":"2026-11-02","merchant":"REWE","category":"Groceries","amountCents":1290,"kind":"expense"}
        ])).unwrap();
        assert!(report_csv(&rows).contains("Groceries"));
        assert!(report_html(&rows, "November").contains("November"));
        let pdf = report_pdf(&rows, "November");
        assert!(pdf.len() > 100);
        let raw = report_pdf_bytes(&rows, "November");
        let text = String::from_utf8_lossy(&raw);
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("startxref"));
        assert!(text.contains("November"));
        let due: Vec<Value> = serde_json::from_value(json!([
            {"name":"Rent","nextDate":"2026-11-20"},
            {"name":"Later","nextDate":"2026-12-20"}
        ])).unwrap();
        assert_eq!(due_soon(&due, "2026-11-18", 7).len(), 1);
        let debts: Vec<Value> = serde_json::from_value(json!([
            {"totalCents":100000,"paidCents":25000}
        ])).unwrap();
        assert_eq!(debt_summary(&debts)["remaining"], 75000);
    }

    #[test]
    fn money_tracker_features() {
        assert_eq!(evaluate("12,50 + 2 * 3"), Some(1850));
        assert_eq!(evaluate("(10-4)*2,5"), Some(1500));
        assert_eq!(evaluate("1/0"), None);
        let rows: Vec<Value> = serde_json::from_value(json!([
            {"date":"2026-11-02","amountCents":2000,"category":"Salary","kind":"income","merchant":"Employer"},
            {"date":"2026-11-03","amountCents":1240,"category":"Groceries","kind":"expense","merchant":"REWE"},
            {"date":"2026-11-04","amountCents":800,"category":"Groceries","kind":"expense","merchant":"Lidl"}
        ])).unwrap();
        let totals = tx_totals(&rows, "2026-11");
        assert_eq!(totals["income"], 2000);
        assert_eq!(totals["expense"], 2040);
        let cats = category_totals(&rows, "2026-11");
        assert_eq!(cats[0]["category"], "Groceries");
        assert_eq!(cats[0]["cents"], 2040);
        let budgets: Vec<Value> = serde_json::from_value(json!([{"category":"Groceries","limitCents":3000}])).unwrap();
        let status = budget_status(&budgets, &cats);
        assert_eq!(status[0]["remaining"], 960);
        let rec: Vec<Value> = serde_json::from_value(json!([{"name":"Rent","amountCents":90000,"dayOfMonth":1,"category":"Rent","active":1}])).unwrap();
        assert_eq!(scheduled(&rec, "2026-11-18")[0]["nextDate"], "2026-12-01");
        assert!(csv_export(&rows).contains("date;merchant;amount"));
    }

    #[test]
    fn prices_and_optimization() {
        let prices = json!([
            {"name":"Milk","storeId":"rewe","date":"2026-11-03","cents":149},
            {"name":"Milk","storeId":"rewe","date":"2026-11-10","cents":129},
            {"name":"Milk","storeId":"lidl","date":"2026-11-03","cents":119},
            {"name":"Milk","storeId":"lidl","date":"2026-11-10","cents":139},
            {"name":"Bread","storeId":"rewe","date":"2026-11-10","cents":189}
        ]);
        let rows: Vec<Value> = serde_json::from_value(prices).unwrap();
        let stats = price_stats(&rows, "Milk", "lidl");
        assert_eq!(stats["current"], 139);
        assert_eq!(stats["min"], 119);
        assert_eq!(stats["series"].as_array().unwrap().len(), 2);
        let items = json!([{"name":"Milk"},{"name":"Bread"}]);
        let items: Vec<Value> = serde_json::from_value(items).unwrap();
        let stores = vec!["rewe".to_string(), "lidl".to_string()];
        let plan = optimize(&rows, &items, &stores, "2026-11-17");
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0]["store"], "rewe");
        assert_eq!(plan[0]["cents"], 129);
        let f = forecast(&rows, "Milk", "rewe", "2026-11-17");
        assert!(f["weekday"].as_str().unwrap().len() > 2);
    }

    #[test]
    fn purchases_and_offers() {
        let purchases = parse_purchases("Milk 2\nEggs\nBread 1", "rewe");
        assert_eq!(purchases.len(), 3);
        assert_eq!(purchases[0]["qty"], "2");
        let offers = parse_offers("Milk 1,29 €\nEggs 2,49", "rewe", "2026-11-17", "paste");
        let list = build_list(&purchases, &offers, "week");
        assert_eq!(list.len(), 3);
        assert_eq!(list[0]["offerPrice"], "1,29 €");
        assert_eq!(list[0]["store"], "rewe");
        assert!(list[1]["offerPrice"].is_null() == false);
    }

    #[test]
    fn recipe_and_summary() {
        let meal = json!({
            "idMeal": "1", "strMeal": "Test Stew", "strCategory": "Beef", "strArea": "German",
            "strInstructions": "Chop.\nSimmer.", "strIngredient1": "Beef", "strMeasure1": "200 g"
        });
        let recipe = normalize_meal(&meal);
        assert_eq!(recipe["ingredients"].as_array().unwrap().len(), 1);
        assert_eq!(recipe["steps"].as_array().unwrap().len(), 2);
        let rows = json!([
            {"date":"2026-11-02","amountCents":1240,"storeId":"rewe"},
            {"date":"2026-11-04","amountCents":860,"storeId":"rewe"}
        ]);
        let rows: Vec<Value> = serde_json::from_value(rows).unwrap();
        let s = store_summary(&rows, "rewe", "2026-11");
        assert_eq!(s["visits"], 2);
        assert_eq!(s["total"], 2100);
    }
}
