//! One search for the whole app: a fuzzy ranking of whatever the app can show (pages, bookings, events,
//! recipes, prices, mail), so the person types a few letters, makes a typo or forgets the order of the
//! words and still finds it. The app gathers the entries; this decides which match and in what order.
//!
//! A query is split into words; every word has to match somewhere in the entry (title, subtitle or
//! keywords). A word matches best as a whole word of the text, then as the start of a word, then inside
//! a word, then with a typo (one wrong, missing, extra or swapped letter, two for long words) and last as
//! letters in order ("hvs" finds "Hausverwaltung Schmidt"). Accents and case do not matter.

use serde::Deserialize;
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub struct Entry {
    pub kind: String,
    pub title: String,
    pub subtitle: String,
    pub keywords: String,
}

/// Lower case, accents and marks taken off (`Müller` is `muller`), `ß` as `ss`.
fn plain(text: &str) -> String {
    text.nfd()
        .filter(|c| !('\u{300}'..='\u{36f}').contains(c))
        .collect::<String>()
        .to_lowercase()
        .replace('ß', "ss")
}

fn words(text: &str) -> Vec<String> {
    plain(text)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

/// Edit distance counting a swapped neighbour pair as one edit ("netfilx" is one away from "netflix").
fn distance(a: &[char], b: &[char]) -> usize {
    let (n, m) = (a.len(), b.len());
    let mut d = vec![vec![0usize; m + 1]; n + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for j in 0..=m {
        d[0][j] = j;
    }
    for i in 1..=n {
        for j in 1..=m {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            d[i][j] = (d[i - 1][j] + 1)
                .min(d[i][j - 1] + 1)
                .min(d[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                d[i][j] = d[i][j].min(d[i - 2][j - 2] + 1);
            }
        }
    }
    d[n][m]
}

/// How well one query word matches one text (already `plain`), 0 for not at all.
fn word_score(q: &str, text: &str, text_words: &[String]) -> i64 {
    if text_words.iter().any(|w| w == q) {
        return 100;
    }
    if text_words.iter().any(|w| w.starts_with(q)) {
        return 85;
    }
    if text.contains(q) {
        return 60;
    }
    let qc: Vec<char> = q.chars().collect();
    if qc.len() >= 4 {
        // a typo in the word, or in the start of a longer word
        let allowed = if qc.len() >= 7 { 2 } else { 1 };
        for w in text_words {
            let wc: Vec<char> = w.chars().collect();
            let cut = &wc[..wc.len().min(qc.len())];
            let best = distance(&qc, &wc).min(distance(&qc, cut));
            if best <= allowed && wc.len() + allowed >= qc.len() {
                return 55 - 10 * (best as i64 - 1).max(0);
            }
        }
    }
    if qc.len() >= 3 {
        // the letters in order, close together scoring higher
        let t: Vec<char> = text.chars().collect();
        let (mut at, mut found, mut gap) = (0usize, 0usize, 0usize);
        for &c in &qc {
            match t[at..].iter().position(|&x| x == c) {
                Some(p) => {
                    gap += p;
                    at += p + 1;
                    found += 1;
                }
                None => break,
            }
        }
        if found == qc.len() {
            return (35 - gap as i64).max(10);
        }
    }
    0
}

/// The score of an entry for a query, 0 when it does not match.
pub fn score(e: &Entry, query: &str) -> i64 {
    let q = words(query);
    if q.is_empty() {
        return 0;
    }
    let fields = [
        (plain(&e.title), 10),
        (plain(&e.subtitle), 6),
        (plain(&e.keywords), 5),
    ];
    let parsed: Vec<(Vec<String>, i64)> = fields.iter().map(|(t, w)| (words(t), *w)).collect();
    let mut total = 0;
    for word in &q {
        let best = fields
            .iter()
            .zip(&parsed)
            .map(|((text, _), (ws, weight))| word_score(word, text, ws) * weight / 10)
            .max()
            .unwrap_or(0);
        if best == 0 {
            return 0;
        }
        total += best;
    }
    let title = plain(&e.title);
    let whole = q.join(" ");
    if title == whole {
        total += 40;
    } else if title.starts_with(&whole) {
        total += 20;
    }
    // a shorter title is the likelier one the person meant
    total * 10 - (title.chars().count() as i64).min(60)
}

/// The entries that match, best first: `[{ index, score }]`. At most `limit_per_kind` of each kind and `limit` in all.
pub fn rank(entries: &[Entry], query: &str, limit_per_kind: usize, limit: usize) -> Vec<Value> {
    let mut hits: Vec<(usize, i64)> = entries
        .iter()
        .enumerate()
        .map(|(i, e)| (i, score(e, query)))
        .filter(|(_, s)| *s > 0)
        .collect();
    hits.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let mut seen: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    hits.into_iter()
        .filter(|(i, _)| {
            let n = seen.entry(entries[*i].kind.as_str()).or_insert(0);
            *n += 1;
            *n <= limit_per_kind
        })
        .take(limit)
        .map(|(index, score)| json!({ "index": index, "score": score }))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(kind: &str, title: &str, subtitle: &str, keywords: &str) -> Entry {
        Entry {
            kind: kind.into(),
            title: title.into(),
            subtitle: subtitle.into(),
            keywords: keywords.into(),
        }
    }

    fn titles(entries: &[Entry], query: &str) -> Vec<String> {
        rank(entries, query, 10, 50)
            .iter()
            .map(|h| entries[h["index"].as_u64().unwrap() as usize].title.clone())
            .collect()
    }

    fn sample() -> Vec<Entry> {
        vec![
            e(
                "page",
                "Spending",
                "Bookings and filters",
                "transactions money",
            ),
            e("page", "Budget", "Envelopes", "limit money"),
            e("page", "Calendar", "Events and reminders", "dates"),
            e(
                "booking",
                "Netflix International",
                "Subscriptions · 05.11.",
                "",
            ),
            e(
                "booking",
                "Hausverwaltung Schmidt",
                "Housing · 02.11.",
                "miete",
            ),
            e(
                "booking",
                "Lidl Dienstleistung GmbH",
                "Groceries · 03.11.",
                "",
            ),
            e("chat", "Max Müller", "Fußball am Freitag", ""),
            e("recipe", "Gurkensalat mit Joghurt", "10 min", "vegetarisch"),
        ]
    }

    #[test]
    fn a_whole_word_beats_a_start_beats_the_inside() {
        let list = [
            e("a", "Tea time", "", ""),
            e("a", "Teaching", "", ""),
            e("a", "Steam", "", ""),
        ];
        assert_eq!(titles(&list, "tea"), ["Tea time", "Teaching", "Steam"]);
    }

    #[test]
    fn a_typo_a_swapped_pair_or_a_missing_letter_still_finds_it() {
        let s = sample();
        assert_eq!(titles(&s, "netfilx")[0], "Netflix International");
        assert_eq!(titles(&s, "spendng")[0], "Spending");
        assert_eq!(titles(&s, "calender")[0], "Calendar");
        assert_eq!(titles(&s, "gurkensalad")[0], "Gurkensalat mit Joghurt");
    }

    #[test]
    fn accents_and_case_do_not_matter() {
        let s = sample();
        assert_eq!(titles(&s, "MULLER")[0], "Max Müller");
        assert_eq!(titles(&s, "fussball")[0], "Max Müller");
    }

    #[test]
    fn every_word_has_to_match_but_not_in_order() {
        let s = sample();
        assert_eq!(titles(&s, "schmidt haus"), ["Hausverwaltung Schmidt"]);
        assert!(titles(&s, "schmidt netflix").is_empty());
        assert_eq!(titles(&s, "groceries lidl"), ["Lidl Dienstleistung GmbH"]);
    }

    #[test]
    fn the_subtitle_and_the_keywords_are_searched_too_but_count_less() {
        let s = sample();
        assert_eq!(titles(&s, "miete"), ["Hausverwaltung Schmidt"]);
        let list = [e("a", "Money", "", ""), e("a", "Spending", "", "money")];
        assert_eq!(titles(&list, "money"), ["Money", "Spending"]);
    }

    #[test]
    fn letters_in_order_are_the_last_resort() {
        let s = sample();
        assert_eq!(titles(&s, "hvs"), ["Hausverwaltung Schmidt"]);
        assert!(titles(&s, "zzz").is_empty());
    }

    #[test]
    fn a_blank_query_finds_nothing_and_the_limits_hold() {
        let s = sample();
        assert!(rank(&s, "  ", 10, 10).is_empty());
        let many: Vec<Entry> = (0..30)
            .map(|i| e("booking", &format!("Lidl {i}"), "", ""))
            .collect();
        assert_eq!(rank(&many, "lidl", 5, 50).len(), 5);
        assert_eq!(rank(&many, "lidl", 50, 7).len(), 7);
    }
}
