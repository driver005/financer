//! A language model as the reader of last resort, for pages without structured data. Off unless a
//! source asks for it (`use_llm`), because it costs API calls and sends the page text to the
//! provider.

use std::sync::Arc;

use async_trait::async_trait;
use financer_llm::LlmProvider;
use financer_prices::pagetext::PageText;
use serde::Deserialize;
use std::collections::BTreeMap;

use crate::extract::{price_to_cents, Extracted};

const MAX_CHARS: usize = 14_000;

const SYSTEM: &str = "You read the visible text of a web shop page and list the products on it. \
Answer with one JSON object: {\"products\":[{\"title\":string,\"brand\":string|null,\"price\":string,\"currency\":string,\
\"specs\":{\"<label as written on the page>\":\"<value as written>\"}}]}. \
Use only what the text says. Copy prices exactly as written. Never invent a price or a spec. \
If the page lists no product, answer {\"products\":[]}.";

/// Reads a page's text into products.
#[async_trait]
pub trait PageReader: Send + Sync {
    async fn read(&self, html: &str, url: &str) -> Result<Vec<Extracted>, String>;
}

pub struct LlmReader {
    llm: Arc<dyn LlmProvider>,
}

impl LlmReader {
    pub fn new(llm: Arc<dyn LlmProvider>) -> LlmReader {
        LlmReader { llm }
    }
}

#[derive(Deserialize)]
struct Answer {
    products: Vec<AnswerProduct>,
}

#[derive(Deserialize)]
struct AnswerProduct {
    title: String,
    brand: Option<String>,
    price: String,
    currency: Option<String>,
    #[serde(default)]
    specs: BTreeMap<String, String>,
}

#[async_trait]
impl PageReader for LlmReader {
    async fn read(&self, html: &str, url: &str) -> Result<Vec<Extracted>, String> {
        let mut text = PageText::html_to_text(html);
        if text.chars().count() > MAX_CHARS {
            text = text.chars().take(MAX_CHARS).collect();
        }
        let answer = self
            .llm
            .complete_json(SYSTEM, &format!("Page text:\n{text}"))
            .await
            .map_err(|e| format!("model call failed: {e}"))?;
        let (Some(start), Some(end)) = (answer.find('{'), answer.rfind('}')) else {
            return Ok(Vec::new());
        };
        let parsed: Answer = serde_json::from_str(&answer[start..=end])
            .map_err(|e| format!("unreadable answer: {e}"))?;
        Ok(parsed
            .products
            .into_iter()
            .filter_map(|p| {
                let title = p.title.trim().to_string();
                let cents = price_to_cents(&p.price)?;
                // the price must literally be on the page: a model must not make one up
                let digits = p.price.trim().trim_end_matches(['€', ' ']).to_string();
                let on_page = text.contains(&digits)
                    || text.contains(&digits.replace('.', ","))
                    || text.contains(&digits.replace(',', "."));
                (!title.is_empty() && title.chars().count() <= 160 && cents > 0 && on_page).then(
                    || Extracted {
                        url: url.to_string(),
                        title,
                        brand: p.brand.filter(|b| !b.trim().is_empty()),
                        currency: p.currency,
                        price_cents: Some(cents),
                        specs: p
                            .specs
                            .into_iter()
                            .filter(|(_, v)| !v.trim().is_empty())
                            .collect(),
                        ..Extracted::default()
                    },
                )
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use financer_llm::MockProvider;

    #[tokio::test]
    async fn keeps_only_products_whose_price_is_on_the_page() {
        let answer = r#"Here: {"products":[
          {"title":"Fairphone 5","brand":"Fairphone","price":"599,00","currency":"EUR","specs":{"Akku":"4200 mAh","Leer":" "}},
          {"title":"Invented","brand":null,"price":"1,00","currency":"EUR","specs":{}},
          {"title":"","brand":null,"price":"599,00","currency":"EUR","specs":{}}]}"#;
        let reader = LlmReader::new(Arc::new(MockProvider::with_answers(vec![Ok(
            answer.to_string()
        )])));
        let html = "<html><body><h1>Fairphone 5</h1><p>599,00 €</p></body></html>";
        let found = reader.read(html, "https://s.test/fp5").await.unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].price_cents, Some(59_900));
        assert_eq!(
            found[0].specs,
            [("Akku".to_string(), "4200 mAh".to_string())]
        );
    }

    #[tokio::test]
    async fn an_answer_without_json_is_no_products() {
        let reader = LlmReader::new(Arc::new(MockProvider::with_answers(vec![Ok(
            "sorry, no".to_string()
        )])));
        assert!(reader.read("<p>x</p>", "u").await.unwrap().is_empty());
    }
}
