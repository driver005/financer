//! Search: a small inverted index with BM25 scoring, typo and prefix tolerance, and a query
//! language that understands `ram>=8`, `price<500`, `brand:google` and "unter 500 €".

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::product::Product;
use crate::rank::{Constraint, Op};
use crate::schema::{CategorySchema, Registry};
use crate::text::{edit_distance, tokenize};
use crate::value::{leading_number, AttrValue};

const K1: f64 = 1.2;
const B: f64 = 0.75;
const MAX_TYPO_EXPANSIONS: usize = 6;

const STOPWORDS: &[&str] = &[
    "the",
    "a",
    "an",
    "with",
    "for",
    "and",
    "or",
    "of",
    "in",
    "best",
    "top",
    "good",
    "cheap",
    "cheapest",
    "beste",
    "bestes",
    "bester",
    "besten",
    "gut",
    "guter",
    "gute",
    "mit",
    "und",
    "oder",
    "fuer",
    "ein",
    "eine",
    "guenstig",
    "guenstige",
    "guenstiger",
    "billig",
    "welches",
    "which",
    "what",
    "is",
    "ist",
    "mein",
    "my",
    "me",
    "i",
    "ich",
    "suche",
    "want",
];
const PRICE_WORDS: &[&str] = &[
    "under", "unter", "below", "max", "maximal", "bis", "less", "upto",
];

/// A query split into what to look for and what to require.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ParsedQuery {
    pub text: String,
    /// Words to match against titles, brands and specs.
    pub terms: Vec<String>,
    pub category: Option<String>,
    pub max_price_cents: Option<i64>,
    pub constraints: Vec<Constraint>,
}

impl ParsedQuery {
    /// `category` forces a category; otherwise the query's own words decide.
    pub fn parse(raw: &str, registry: &Registry, category: Option<&str>) -> ParsedQuery {
        let chunks: Vec<&str> = raw.split_whitespace().collect();
        let plain: Vec<String> = chunks
            .iter()
            .filter(|c| !Self::is_operator(c))
            .flat_map(|c| tokenize(c))
            .collect();
        let explicit = chunks.iter().find_map(|c| {
            c.strip_prefix("category:")
                .or_else(|| c.strip_prefix("kategorie:"))
                .map(str::to_string)
        });
        let category = category
            .map(str::to_string)
            .or(explicit)
            .filter(|c| registry.raw(c).is_some())
            .or_else(|| registry.detect(&plain));
        let schema = category.as_deref().and_then(|c| registry.resolved(c).ok());

        let mut q = ParsedQuery {
            text: raw.trim().to_string(),
            category: category.clone(),
            ..ParsedQuery::default()
        };
        let mut words: Vec<String> = Vec::new();
        let mut i = 0;
        while i < chunks.len() {
            let chunk = chunks[i];
            let lower = chunk.to_lowercase();
            if lower.starts_with("category:") || lower.starts_with("kategorie:") {
                i += 1;
                continue;
            }
            if let Some(c) = Self::operator(chunk, schema.as_ref()) {
                if c.attribute == "price" && matches!(c.op, Op::Lte) {
                    q.max_price_cents = c.value.as_f64().map(|e| (e * 100.0).round() as i64);
                } else {
                    q.constraints.push(c);
                }
                i += 1;
                continue;
            }
            // "unter 500", "under 500€", "< 500 eur", "bis 1.000 euro"
            let word = tokenize(chunk);
            if (word.len() == 1 && PRICE_WORDS.contains(&word[0].as_str())) || chunk == "<" {
                if let Some(next) = chunks.get(i + 1).and_then(|n| leading_number(n)) {
                    q.max_price_cents = Some((next * 100.0).round() as i64);
                    i += 2;
                    if chunks
                        .get(i)
                        .is_some_and(|u| matches!(u.to_lowercase().as_str(), "eur" | "euro" | "€"))
                    {
                        i += 1;
                    }
                    continue;
                }
            }
            if let Some(n) = chunk.strip_prefix('<').and_then(leading_number) {
                q.max_price_cents = Some((n * 100.0).round() as i64);
                i += 1;
                continue;
            }
            words.extend(word);
            i += 1;
        }
        // a currency sign glued to a number that survived ("500€")
        let category_words: Vec<String> = category
            .as_deref()
            .and_then(|c| registry.resolved(c).ok())
            .map(|s| {
                let keep: Vec<String> = s.name_words.iter().flat_map(|k| tokenize(k)).collect();
                s.keywords
                    .iter()
                    .flat_map(|k| tokenize(k))
                    .filter(|w| !keep.contains(w))
                    .collect()
            })
            .unwrap_or_default();
        q.terms = words
            .into_iter()
            .filter(|w| !STOPWORDS.contains(&w.as_str()) && !category_words.contains(w))
            .collect();
        q
    }

    fn is_operator(chunk: &str) -> bool {
        chunk.contains(['>', '<', '=']) || (chunk.contains(':') && !chunk.ends_with(':'))
    }

    fn operator(chunk: &str, schema: Option<&CategorySchema>) -> Option<Constraint> {
        let pos = chunk.find(['>', '<', '=', ':'])?;
        let (key, rest) = chunk.split_at(pos);
        let (op, value) =
            if let Some(v) = rest.strip_prefix(">=").or_else(|| rest.strip_prefix('>')) {
                (Op::Gte, v)
            } else if let Some(v) = rest.strip_prefix("<=").or_else(|| rest.strip_prefix('<')) {
                (Op::Lte, v)
            } else {
                (Op::Eq, rest.get(1..)?)
            };
        let value = value.trim().trim_start_matches('=');
        if key.is_empty() || value.is_empty() {
            return None;
        }
        let attribute = match key.to_lowercase().as_str() {
            "price" | "preis" => "price".to_string(),
            "brand" | "marke" => "brand".to_string(),
            other => {
                let s = schema?;
                s.attribute(other)
                    .or_else(|| s.attribute_named(key))
                    .map(|a| a.key.clone())?
            }
        };
        let numeric = leading_number(value)
            .filter(|_| value.chars().next().is_some_and(|c| c.is_ascii_digit()));
        let (op, value) = match (numeric, op, chunk.contains(':')) {
            (Some(n), Op::Eq, true) if attribute != "price" => (Op::Gte, AttrValue::Num(n)),
            (Some(n), _, _) => (op, AttrValue::Num(n)),
            (None, Op::Eq, _) if matches!(value.to_lowercase().as_str(), "yes" | "ja" | "true") => {
                (Op::Eq, AttrValue::Bool(true))
            }
            (None, Op::Eq, _)
                if matches!(value.to_lowercase().as_str(), "no" | "nein" | "false") =>
            {
                (Op::Eq, AttrValue::Bool(false))
            }
            (None, Op::Eq, _) => (Op::Contains, AttrValue::Text(value.to_string())),
            (None, _, _) => return None,
        };
        Some(Constraint {
            attribute,
            op,
            value,
        })
    }
}

struct Doc {
    id: String,
    category: String,
    len: f64,
}

/// An in-memory index over a set of products. Cheap to rebuild; the server keeps one per
/// category set and swaps it after a crawl.
#[derive(Default)]
pub struct Index {
    docs: Vec<Doc>,
    postings: HashMap<String, Vec<(u32, f64)>>,
    avg_len: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hit {
    pub id: String,
    pub score: f64,
}

impl Index {
    pub fn build(products: &[Product]) -> Index {
        let mut idx = Index::default();
        for p in products {
            let mut tf: BTreeMap<String, f64> = BTreeMap::new();
            let mut add = |text: &str, weight: f64| {
                for t in tokenize(text) {
                    *tf.entry(t).or_default() += weight;
                }
            };
            add(&p.title, 3.0);
            if let Some(b) = &p.brand {
                add(b, 2.0);
            }
            if let Some(m) = &p.model {
                add(m, 2.0);
            }
            if let Some(g) = &p.gtin {
                add(g, 2.0);
            }
            for t in &p.tags {
                add(t, 1.0);
            }
            for v in p.attributes.values() {
                if let AttrValue::Text(_) | AttrValue::List(_) = v {
                    add(&v.to_string(), 0.5);
                }
            }
            let len: f64 = tf.values().sum();
            let doc = idx.docs.len() as u32;
            idx.docs.push(Doc {
                id: p.id.clone(),
                category: p.category.clone(),
                len,
            });
            for (term, w) in tf {
                idx.postings.entry(term).or_default().push((doc, w));
            }
        }
        idx.avg_len = if idx.docs.is_empty() {
            1.0
        } else {
            idx.docs.iter().map(|d| d.len).sum::<f64>() / idx.docs.len() as f64
        };
        idx
    }

    pub fn len(&self) -> usize {
        self.docs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }

    /// The vocabulary words a query word may stand for: itself, near misspellings, and (for the
    /// last word, which may still be typed) words it is the start of.
    fn expand(&self, term: &str, last: bool) -> Vec<String> {
        if self.postings.contains_key(term) {
            return vec![term.to_string()];
        }
        let max = match term.chars().count() {
            0..=3 => 0,
            4..=7 => 1,
            _ => 2,
        };
        let mut found: Vec<(usize, &String)> = self
            .postings
            .keys()
            .filter_map(|v| {
                if last && term.len() >= 3 && v.starts_with(term) {
                    return Some((0, v));
                }
                if max == 0 {
                    return None;
                }
                let d = edit_distance(term, v, max);
                (d <= max).then_some((d, v))
            })
            .collect();
        found.sort();
        found
            .into_iter()
            .take(MAX_TYPO_EXPANSIONS)
            .map(|(_, v)| v.clone())
            .collect()
    }

    /// Best matches first. With no terms every product (of the category) is a hit with score 0.
    /// Most words must match: all of up to two, 60 % of more.
    pub fn search(&self, terms: &[String], category: Option<&str>, limit: usize) -> Vec<Hit> {
        let in_category = |d: &Doc| category.is_none_or(|c| d.category == c);
        if terms.is_empty() {
            let mut all: Vec<Hit> = self
                .docs
                .iter()
                .filter(|d| in_category(d))
                .map(|d| Hit {
                    id: d.id.clone(),
                    score: 0.0,
                })
                .collect();
            all.sort_by(|a, b| a.id.cmp(&b.id));
            all.truncate(limit);
            return all;
        }
        let n = self.docs.len() as f64;
        let mut score: HashMap<u32, f64> = HashMap::new();
        let mut matched: HashMap<u32, usize> = HashMap::new();
        for (i, term) in terms.iter().enumerate() {
            let mut best: HashMap<u32, f64> = HashMap::new();
            for word in self.expand(term, i == terms.len() - 1) {
                let Some(list) = self.postings.get(&word) else {
                    continue;
                };
                let df = list.len() as f64;
                let idf = (1.0 + (n - df + 0.5) / (df + 0.5)).ln();
                let penalty = if &word == term { 1.0 } else { 0.7 };
                for (doc, tf) in list {
                    let len = self.docs[*doc as usize].len;
                    let s = idf * tf * (K1 + 1.0) / (tf + K1 * (1.0 - B + B * len / self.avg_len))
                        * penalty;
                    let e = best.entry(*doc).or_default();
                    *e = e.max(s);
                }
            }
            for (doc, s) in best {
                *score.entry(doc).or_default() += s;
                *matched.entry(doc).or_default() += 1;
            }
        }
        let need = if terms.len() <= 2 {
            terms.len()
        } else {
            (terms.len() * 3).div_ceil(5)
        };
        let mut hits: Vec<Hit> = score
            .into_iter()
            .filter(|(doc, _)| matched[doc] >= need && in_category(&self.docs[*doc as usize]))
            .map(|(doc, s)| Hit {
                id: self.docs[doc as usize].id.clone(),
                score: s,
            })
            .collect();
        hits.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.id.cmp(&b.id)));
        hits.truncate(limit);
        hits
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::product::Offer;

    fn catalog() -> Vec<Product> {
        let mk = |cat: &str, title: &str, brand: &str| {
            let mut p = Product::new(cat, title).with_offer(Offer::one_time("s", "u", 100));
            p.brand = Some(brand.into());
            p
        };
        vec![
            mk("smartphone", "Google Pixel 9 128GB", "Google"),
            mk("smartphone", "Google Pixel 9 Pro 256GB", "Google"),
            mk("smartphone", "Samsung Galaxy S25 Ultra", "Samsung"),
            mk("smartphone", "Apple iPhone 16", "Apple"),
            mk("laptop", "Apple MacBook Air 13", "Apple"),
            mk("headphones", "Sony WH-1000XM5 Kopfhörer", "Sony"),
        ]
    }

    fn ids(hits: &[Hit]) -> Vec<&str> {
        hits.iter().map(|h| h.id.as_str()).collect()
    }

    fn q(raw: &str) -> ParsedQuery {
        ParsedQuery::parse(raw, &Registry::builtin(), None)
    }

    #[test]
    fn finds_by_title_brand_and_numbers() {
        let idx = Index::build(&catalog());
        assert_eq!(
            ids(&idx.search(&["pixel".into(), "9".into()], None, 10))[0],
            "smartphone:google-pixel-9-128-gb"
        );
        assert_eq!(idx.search(&["apple".into()], None, 10).len(), 2);
        assert_eq!(idx.search(&["apple".into()], Some("laptop"), 10).len(), 1);
        assert!(idx.search(&["nokia".into()], None, 10).is_empty());
    }

    #[test]
    fn tolerates_typos_and_unfinished_words() {
        let idx = Index::build(&catalog());
        assert_eq!(
            ids(&idx.search(&["galxy".into()], None, 10)),
            ["smartphone:samsung-galaxy-s-25-ultra"]
        );
        assert_eq!(ids(&idx.search(&["samsu".into()], None, 10)).len(), 1);
        assert_eq!(idx.search(&["kopfhoerer".into()], None, 10).len(), 1);
    }

    #[test]
    fn more_words_must_mostly_match() {
        let idx = Index::build(&catalog());
        let terms: Vec<String> = ["google", "pixel", "9", "pro"].map(String::from).to_vec();
        let hits = idx.search(&terms, None, 10);
        assert_eq!(hits[0].id, "smartphone:google-pixel-9-pro-256-gb");
        // two words must both match
        assert!(idx
            .search(&["google".into(), "iphone".into()], None, 10)
            .is_empty());
    }

    #[test]
    fn no_terms_lists_the_category() {
        let idx = Index::build(&catalog());
        assert_eq!(idx.search(&[], Some("smartphone"), 10).len(), 4);
        assert_eq!(idx.search(&[], Some("smartphone"), 2).len(), 2);
    }

    #[test]
    fn natural_language_queries_become_category_price_and_terms() {
        let p = q("beste handy unter 500 € mit google");
        assert_eq!(p.category.as_deref(), Some("smartphone"));
        assert_eq!(p.max_price_cents, Some(50_000));
        assert_eq!(p.terms, ["google"]);

        // model lines stay in the terms: they are words in product names
        assert_eq!(q("pixel 9").terms, ["pixel", "9"]);
        assert_eq!(q("pixel 9").category.as_deref(), Some("smartphone"));

        let p = q("best phone under 1.200 eur");
        assert_eq!(p.max_price_cents, Some(120_000));
        assert!(p.terms.is_empty());

        let p = q("laptop <900");
        assert_eq!(p.category.as_deref(), Some("laptop"));
        assert_eq!(p.max_price_cents, Some(90_000));
    }

    #[test]
    fn operators_become_constraints_on_known_attributes() {
        let p = q(
            "phone ram_gb>=8 battery_mah>4500 brand:google nfc:yes price<600 akkukapazität:5000",
        );
        assert_eq!(p.category.as_deref(), Some("smartphone"));
        assert_eq!(p.max_price_cents, Some(60_000));
        let find = |a: &str| p.constraints.iter().find(|c| c.attribute == a).unwrap();
        assert_eq!(find("ram_gb").op, Op::Gte);
        assert_eq!(find("brand").op, Op::Contains);
        assert_eq!(find("brand").value, AttrValue::Text("google".into()));
        assert_eq!(find("battery_mah").value, AttrValue::Num(4500.0));
        assert!(p.terms.is_empty(), "{:?}", p.terms);
    }

    #[test]
    fn an_explicit_category_wins() {
        let p = ParsedQuery::parse("apple", &Registry::builtin(), Some("laptop"));
        assert_eq!(p.category.as_deref(), Some("laptop"));
        assert_eq!(p.terms, ["apple"]);
        let p = q("category:headphones sony");
        assert_eq!(p.category.as_deref(), Some("headphones"));
        assert_eq!(p.terms, ["sony"]);
    }
}
