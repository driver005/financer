//! Category schemas: which attributes a kind of product has and by which criteria it is judged.
//! This is the extension point. A schema is plain JSON; a new category, a new criterion or a new
//! attribute is a data change, stored with the rest of the data and edited in the app.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::formula::Formula;
use crate::text::fold_key;
use crate::value::{leading_number, AttrValue, Attributes};

const MAX_EXTENDS_DEPTH: usize = 8;

/// Names a formula can use besides attributes; they come from the best offer. `price` is the
/// comparable price in euros (total for purchases, effective monthly for plans), `monthly` the
/// effective monthly cost, `upfront` what is due at once and `term_months` the commitment.
pub const SPECIAL_VARIABLES: &[&str] = &["price", "monthly", "upfront", "term_months"];

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SchemaError {
    #[error("unknown category {0:?}")]
    Unknown(String),
    #[error("category {0:?} extends itself")]
    Cycle(String),
    #[error("invalid category: {}", .0.join("; "))]
    Invalid(Vec<String>),
}

/// Whether a category holds things you buy once or things you subscribe to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CategoryKind {
    #[default]
    Product,
    Subscription,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttrKind {
    #[default]
    Number,
    Text,
    Bool,
    List,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttributeDef {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub kind: AttrKind,
    /// Shown after numbers (`mAh`); the canonical unit all values are converted to.
    #[serde(default)]
    pub unit: Option<String>,
    /// Other names this spec has on shop pages ("Akkukapazität", "Battery capacity").
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Factors to the canonical unit for units found in the text: `{"tb": 1000, "gb": 1}`.
    #[serde(default)]
    pub units: BTreeMap<String, f64>,
    /// Words that stand for a number: `{"unlimited": 1000, "unbegrenzt": 1000}`.
    #[serde(default)]
    pub words: BTreeMap<String, f64>,
}

impl AttributeDef {
    /// Whether a spec label from a page names this attribute.
    pub fn names(&self, label: &str) -> bool {
        let want = fold_key(label);
        if want.is_empty() {
            return false;
        }
        std::iter::once(&self.key)
            .chain(std::iter::once(&self.label))
            .chain(self.aliases.iter())
            .any(|n| fold_key(&n.replace('_', " ")) == want)
    }

    /// Read a value as a page writes it: `"5.000 mAh"`, `"1 TB"`, `"Ja"`, `"IP68, NFC"`.
    pub fn parse(&self, raw: &str) -> Option<AttrValue> {
        let raw = raw.trim();
        if raw.is_empty() {
            return None;
        }
        match self.kind {
            AttrKind::Number => {
                let lower = raw.to_lowercase();
                let words = crate::text::tokenize(&lower);
                if let Some(n) = self
                    .words
                    .iter()
                    .find(|(w, _)| words.contains(&crate::text::fold_key(w)))
                    .map(|(_, n)| *n)
                {
                    return Some(AttrValue::Num(n));
                }
                let n = leading_number(raw)?;
                let factor = self
                    .units
                    .iter()
                    .filter(|(u, _)| words.iter().any(|t| *t == u.to_lowercase()))
                    .map(|(_, f)| *f)
                    .next()
                    .unwrap_or(1.0);
                Some(AttrValue::Num(n * factor))
            }
            AttrKind::Bool => AttrValue::Text(raw.into()).as_bool().map(AttrValue::Bool),
            AttrKind::Text => Some(AttrValue::Text(raw.into())),
            AttrKind::List => Some(AttrValue::List(
                raw.split([',', ';', '/', '|'])
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string)
                    .collect(),
            )),
        }
    }

    /// `5000 mAh`, `yes`, `Android`.
    pub fn display(&self, v: &AttrValue) -> String {
        match (&self.unit, v) {
            (Some(u), AttrValue::Num(_)) => format!("{v} {u}"),
            _ => v.to_string(),
        }
    }
}

/// Fill a missing attribute from others: `os` containing "android" adds `android` to
/// `ecosystem`. Rules add to a list attribute, so a Samsung phone can be both "android" and
/// "samsung".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeriveRule {
    pub attribute: String,
    /// An attribute key, or `title` / `brand`.
    pub from: String,
    pub contains: String,
    pub add: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Scale {
    /// Lowest value 0, highest 1. Smooth, but one outlier squeezes the rest.
    #[default]
    Minmax,
    /// Share of products it beats; robust against outliers, coarse with few products.
    Percentile,
    /// Absolute reference, independent of what else is in the list: 3000 mAh is 0, 6000 is 1.
    Fixed { min: f64, max: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Missing {
    /// Judge by the criteria that are known (and lower the confidence).
    #[default]
    Skip,
    /// Count as the middle of the range.
    Neutral,
    /// Count as the worst.
    Worst,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CriterionKind {
    /// A numeric attribute, scaled.
    Number { attribute: String },
    /// A text attribute mapped to a score: `{"IP68": 1.0, "IP67": 0.8}`.
    Choice {
        attribute: String,
        scores: BTreeMap<String, f64>,
        #[serde(default)]
        default: Option<f64>,
    },
    /// A yes/no attribute.
    Flag { attribute: String },
    /// Matches the person's preference (`ecosystem: apple`): 1 preferred, 0 avoided, else 0.5.
    Match {
        attribute: String,
        preference: String,
    },
    /// Newness of a date attribute: 1 when brand new, 0.5 after `half_life_months`.
    Age {
        attribute: String,
        half_life_months: f64,
    },
    /// Any arithmetic over attributes (see `formula`), also `price` and `monthly`.
    Formula { expr: String },
    /// The best price (purchase total, or effective monthly cost for plans).
    Price,
    /// How far below its usual price it is right now.
    Deal,
}

fn one() -> f64 {
    1.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CriterionDef {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    /// Default importance; a profile overrides it. 0 switches the criterion off.
    #[serde(default = "one")]
    pub weight: f64,
    #[serde(flatten)]
    pub source: CriterionKind,
    /// Defaults to true, except for prices.
    #[serde(default)]
    pub higher_is_better: Option<bool>,
    #[serde(default)]
    pub scale: Scale,
    /// Scale the logarithm of the value (storage 64 -> 1024 GB is four doublings, not 960 GB).
    #[serde(default)]
    pub log: bool,
    #[serde(default)]
    pub missing: Missing,
    #[serde(default)]
    pub group: Option<String>,
}

impl CriterionDef {
    pub fn higher_is_better(&self) -> bool {
        self.higher_is_better
            .unwrap_or(!matches!(self.source, CriterionKind::Price))
    }

    /// Price and deal criteria are the "cost" side; the rest is "quality".
    pub fn is_cost(&self) -> bool {
        matches!(self.source, CriterionKind::Price | CriterionKind::Deal)
    }

    /// Kinds that produce a 0..1 score themselves and are not scaled.
    pub fn is_direct(&self) -> bool {
        matches!(
            self.source,
            CriterionKind::Choice { .. }
                | CriterionKind::Flag { .. }
                | CriterionKind::Match { .. }
                | CriterionKind::Age { .. }
        )
    }

    pub fn problems(&self, attributes: &BTreeSet<&str>, out: &mut Vec<String>) {
        let key = &self.key;
        if key.trim().is_empty() {
            out.push("a criterion has no key".into());
        }
        if !(self.weight.is_finite() && self.weight >= 0.0) {
            out.push(format!("{key}: weight must be 0 or more"));
        }
        let mut need = |attr: &str| {
            if !attributes.contains(attr) {
                out.push(format!("{key}: unknown attribute {attr:?}"));
            }
        };
        match &self.source {
            CriterionKind::Number { attribute }
            | CriterionKind::Flag { attribute }
            | CriterionKind::Match { attribute, .. }
            | CriterionKind::Age { attribute, .. }
            | CriterionKind::Choice { attribute, .. } => need(attribute),
            CriterionKind::Formula { expr } => match Formula::parse(expr) {
                Ok(f) => {
                    for v in f.variables() {
                        if !SPECIAL_VARIABLES.contains(&v.as_str())
                            && !attributes.contains(v.as_str())
                        {
                            out.push(format!("{key}: formula uses unknown attribute {v:?}"));
                        }
                    }
                }
                Err(e) => out.push(format!("{key}: {e}")),
            },
            CriterionKind::Price | CriterionKind::Deal => {}
        }
        if let CriterionKind::Age {
            half_life_months, ..
        } = &self.source
        {
            if half_life_months.is_nan() || *half_life_months <= 0.0 {
                out.push(format!("{key}: half_life_months must be above 0"));
            }
        }
        if let Scale::Fixed { min, max } = &self.scale {
            if min.is_nan() || max.is_nan() || min >= max {
                out.push(format!("{key}: fixed scale needs min below max"));
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct CategorySchema {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: CategoryKind,
    /// Another category to start from; this one adds to or replaces its attributes and criteria.
    #[serde(default)]
    pub extends: Option<String>,
    /// Words in a query that point to this category ("handy", "smartphone").
    #[serde(default)]
    pub keywords: Vec<String>,
    /// Keywords that are also words in product names (`pixel`, `macbook`): a search keeps them as
    /// terms to match. The other keywords only name the category and are dropped from the terms.
    #[serde(default)]
    pub name_words: Vec<String>,
    #[serde(default)]
    pub attributes: Vec<AttributeDef>,
    #[serde(default)]
    pub derive: Vec<DeriveRule>,
    #[serde(default)]
    pub criteria: Vec<CriterionDef>,
    /// Names of the price bands, cheapest first (`budget`, `mid-range`, ...).
    #[serde(default)]
    pub tiers: Vec<String>,
    /// For inherited criteria: keys to drop.
    #[serde(default)]
    pub remove: Vec<String>,
}

impl CategorySchema {
    pub fn attribute(&self, key: &str) -> Option<&AttributeDef> {
        self.attributes.iter().find(|a| a.key == key)
    }

    /// Resolve a spec label from a page to an attribute.
    pub fn attribute_named(&self, label: &str) -> Option<&AttributeDef> {
        self.attributes.iter().find(|a| a.names(label))
    }

    pub fn criterion(&self, key: &str) -> Option<&CriterionDef> {
        self.criteria.iter().find(|c| c.key == key)
    }

    pub fn tier_names(&self) -> Vec<String> {
        if self.tiers.is_empty() {
            ["budget", "mid-range", "upper mid-range", "premium"]
                .map(String::from)
                .to_vec()
        } else {
            self.tiers.clone()
        }
    }

    /// Everything wrong with the definition, for the editor to show.
    pub fn problems(&self) -> Vec<String> {
        let mut out = Vec::new();
        if self.id.trim().is_empty()
            || !self
                .id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        {
            out.push("id must be lower-case letters, digits and underscores".into());
        }
        if self.name.trim().is_empty() {
            out.push("name is empty".into());
        }
        let mut keys = BTreeSet::new();
        for a in &self.attributes {
            if a.key.trim().is_empty() || !keys.insert(a.key.as_str()) {
                out.push(format!("attribute key {:?} is empty or used twice", a.key));
            }
        }
        let mut ckeys = BTreeSet::new();
        for c in &self.criteria {
            if !ckeys.insert(c.key.as_str()) {
                out.push(format!("criterion {:?} is defined twice", c.key));
            }
            c.problems(&keys, &mut out);
        }
        for d in &self.derive {
            if !keys.contains(d.attribute.as_str()) {
                out.push(format!("derive: unknown attribute {:?}", d.attribute));
            }
        }
        out
    }

    /// Put spec pairs from a page into attributes, by label. Returns the labels nobody claimed,
    /// so a crawler can show what the schema is missing.
    pub fn ingest<'a>(
        &self,
        attrs: &mut Attributes,
        specs: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> Vec<String> {
        let mut unclaimed = Vec::new();
        for (label, value) in specs {
            match self.attribute_named(label) {
                Some(def) => {
                    if let Some(v) = def.parse(value) {
                        attrs.entry(def.key.clone()).or_insert(v);
                    }
                }
                None => unclaimed.push(label.to_string()),
            }
        }
        unclaimed
    }

    /// Fill derived attributes (ecosystem from OS and brand, ...).
    pub fn derive_attributes(&self, title: &str, brand: Option<&str>, attrs: &mut Attributes) {
        let mut found: BTreeMap<&str, Vec<String>> = BTreeMap::new();
        for rule in &self.derive {
            let haystack = match rule.from.as_str() {
                "title" => Some(title.to_lowercase()),
                "brand" => brand.map(str::to_lowercase),
                key => attrs.get(key).map(|v| v.tokens().join(" ")),
            };
            if haystack.is_some_and(|h| h.contains(&rule.contains.to_lowercase())) {
                let list = found.entry(rule.attribute.as_str()).or_default();
                for a in &rule.add {
                    if !list.contains(a) {
                        list.push(a.clone());
                    }
                }
            }
        }
        for (key, values) in found {
            if !attrs.contains_key(key) {
                attrs.insert(key.to_string(), AttrValue::List(values));
            }
        }
    }
}

/// All categories: the built-in ones plus whatever the user defined or changed.
#[derive(Debug, Clone, Default)]
pub struct Registry {
    raw: BTreeMap<String, CategorySchema>,
}

const BUILTIN: &[&str] = &[
    include_str!("../builtin/generic.json"),
    include_str!("../builtin/smartphone.json"),
    include_str!("../builtin/laptop.json"),
    include_str!("../builtin/headphones.json"),
    include_str!("../builtin/mobile_plan.json"),
    include_str!("../builtin/internet_plan.json"),
    include_str!("../builtin/streaming.json"),
];

impl Registry {
    pub fn builtin() -> Registry {
        let mut r = Registry::default();
        for json in BUILTIN {
            let schema: CategorySchema =
                serde_json::from_str(json).expect("built-in category schema is valid JSON");
            r.raw.insert(schema.id.clone(), schema);
        }
        r
    }

    /// Add or replace a category after checking it resolves and validates.
    pub fn put(&mut self, schema: CategorySchema) -> Result<(), SchemaError> {
        let previous = self.raw.insert(schema.id.clone(), schema.clone());
        match self.resolved(&schema.id) {
            Ok(resolved) => {
                let problems = resolved.problems();
                if problems.is_empty() {
                    Ok(())
                } else {
                    self.restore(&schema.id, previous);
                    Err(SchemaError::Invalid(problems))
                }
            }
            Err(e) => {
                self.restore(&schema.id, previous);
                Err(e)
            }
        }
    }

    fn restore(&mut self, id: &str, previous: Option<CategorySchema>) {
        match previous {
            Some(p) => self.raw.insert(id.to_string(), p),
            None => self.raw.remove(id),
        };
    }

    pub fn remove(&mut self, id: &str) -> bool {
        self.raw.remove(id).is_some()
    }

    pub fn ids(&self) -> Vec<&str> {
        self.raw.keys().map(String::as_str).collect()
    }

    /// The definition as written (not merged with what it extends).
    pub fn raw(&self, id: &str) -> Option<&CategorySchema> {
        self.raw.get(id)
    }

    /// The category with everything it extends merged in.
    pub fn resolved(&self, id: &str) -> Result<CategorySchema, SchemaError> {
        self.resolve_depth(id, 0)
    }

    fn resolve_depth(&self, id: &str, depth: usize) -> Result<CategorySchema, SchemaError> {
        if depth > MAX_EXTENDS_DEPTH {
            return Err(SchemaError::Cycle(id.to_string()));
        }
        let own = self
            .raw
            .get(id)
            .ok_or_else(|| SchemaError::Unknown(id.to_string()))?;
        let Some(parent_id) = &own.extends else {
            return Ok(own.clone());
        };
        let mut merged = self.resolve_depth(parent_id, depth + 1)?;
        merged.id = own.id.clone();
        merged.name = own.name.clone();
        merged.extends = own.extends.clone();
        merged.kind = own.kind;
        if !own.tiers.is_empty() {
            merged.tiers = own.tiers.clone();
        }
        merged.keywords.extend(own.keywords.iter().cloned());
        merged.name_words.extend(own.name_words.iter().cloned());
        merged.criteria.retain(|c| !own.remove.contains(&c.key));
        for a in &own.attributes {
            match merged.attributes.iter_mut().find(|x| x.key == a.key) {
                Some(slot) => *slot = a.clone(),
                None => merged.attributes.push(a.clone()),
            }
        }
        for c in &own.criteria {
            match merged.criteria.iter_mut().find(|x| x.key == c.key) {
                Some(slot) => *slot = c.clone(),
                None => merged.criteria.push(c.clone()),
            }
        }
        merged.derive.extend(own.derive.iter().cloned());
        Ok(merged)
    }

    /// Which category a free-text query is about, by the categories' keywords.
    pub fn detect(&self, query_tokens: &[String]) -> Option<String> {
        let mut best: Option<(usize, &str)> = None;
        for (id, s) in &self.raw {
            let Ok(r) = self.resolved(id) else { continue };
            let hits = r
                .keywords
                .iter()
                .chain(std::iter::once(&s.name))
                .map(|k| crate::text::tokenize(k))
                .filter(|kw| !kw.is_empty() && kw.iter().all(|t| query_tokens.contains(t)))
                .map(|kw| kw.len())
                .max()
                .unwrap_or(0);
            if hits > 0 && best.is_none_or(|(b, _)| hits > b) {
                best = Some((hits, id));
            }
        }
        best.map(|(_, id)| id.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_builtin_category_is_valid() {
        let reg = Registry::builtin();
        assert!(reg.ids().len() >= 7);
        for id in reg.ids() {
            let s = reg.resolved(id).unwrap();
            assert_eq!(s.problems(), Vec::<String>::new(), "category {id}");
        }
    }

    #[test]
    fn labels_resolve_to_attributes_and_values_are_converted() {
        let reg = Registry::builtin();
        let phone = reg.resolved("smartphone").unwrap();
        let mut attrs = Attributes::new();
        let unclaimed = phone.ingest(
            &mut attrs,
            [
                ("Akkukapazität", "5.000 mAh"),
                ("Speicher", "1 TB"),
                ("Arbeitsspeicher", "12 GB"),
                ("NFC", "Ja"),
                ("Betriebssystem", "Android 15"),
                ("Lieblingsfarbe", "rot"),
            ],
        );
        assert_eq!(attrs["battery_mah"], AttrValue::Num(5000.0));
        assert_eq!(attrs["storage_gb"], AttrValue::Num(1000.0));
        assert_eq!(attrs["ram_gb"], AttrValue::Num(12.0));
        assert_eq!(attrs["nfc"], AttrValue::Bool(true));
        assert_eq!(unclaimed, ["Lieblingsfarbe"]);
    }

    #[test]
    fn ecosystem_is_derived_from_os_and_brand() {
        let phone = Registry::builtin().resolved("smartphone").unwrap();
        let mut attrs = Attributes::new();
        attrs.insert("os".into(), AttrValue::Text("Android 15".into()));
        phone.derive_attributes("Samsung Galaxy S25", Some("Samsung"), &mut attrs);
        assert_eq!(
            attrs["ecosystem"],
            AttrValue::List(vec!["android".into(), "samsung".into()])
        );
        // an explicit value is never overwritten
        let mut given = Attributes::new();
        given.insert("ecosystem".into(), AttrValue::List(vec!["x".into()]));
        phone.derive_attributes("Samsung Galaxy S25", Some("Samsung"), &mut given);
        assert_eq!(given["ecosystem"], AttrValue::List(vec!["x".into()]));
    }

    #[test]
    fn a_category_can_extend_another_and_add_a_criterion_and_attribute() {
        let mut reg = Registry::builtin();
        let custom: CategorySchema = serde_json::from_str(
            r#"{
              "id": "gaming_phone", "name": "Gaming phone", "extends": "smartphone",
              "keywords": ["gaming phone"],
              "remove": ["weight"],
              "attributes": [{"key": "trigger_buttons", "label": "Shoulder triggers", "kind": "bool", "aliases": ["Schultertasten"]}],
              "criteria": [
                {"key": "triggers", "label": "Shoulder triggers", "kind": "flag", "attribute": "trigger_buttons", "weight": 2},
                {"key": "battery", "label": "Battery", "kind": "number", "attribute": "battery_mah", "weight": 4, "scale": {"type": "fixed", "min": 4000, "max": 8000}}
              ]
            }"#,
        )
        .unwrap();
        reg.put(custom).unwrap();
        let s = reg.resolved("gaming_phone").unwrap();
        assert!(s.attribute("trigger_buttons").is_some());
        assert!(s.attribute("battery_mah").is_some(), "inherited");
        assert!(s.criterion("weight").is_none(), "removed");
        assert_eq!(s.criterion("battery").unwrap().weight, 4.0, "overridden");
        assert!(s.criterion("camera").is_some(), "inherited");
        assert_eq!(s.kind, CategoryKind::Product);
        assert_eq!(
            s.attribute_named("Schultertasten").unwrap().key,
            "trigger_buttons"
        );
    }

    #[test]
    fn invalid_definitions_are_rejected_and_leave_the_registry_unchanged() {
        let mut reg = Registry::builtin();
        let before = reg.ids().len();
        let bad: CategorySchema = serde_json::from_str(
            r#"{"id": "x", "name": "X",
                "attributes": [{"key": "a", "label": "A"}],
                "criteria": [
                  {"key": "c1", "label": "C1", "kind": "number", "attribute": "nope"},
                  {"key": "c2", "label": "C2", "kind": "formula", "expr": "a / (b"},
                  {"key": "c3", "label": "C3", "kind": "formula", "expr": "a + ghost"}
                ]}"#,
        )
        .unwrap();
        let Err(SchemaError::Invalid(problems)) = reg.put(bad) else {
            panic!("expected invalid")
        };
        assert_eq!(problems.len(), 3, "{problems:?}");
        assert_eq!(reg.ids().len(), before);

        let orphan = CategorySchema {
            id: "y".into(),
            name: "Y".into(),
            extends: Some("missing".into()),
            ..Default::default()
        };
        assert_eq!(reg.put(orphan), Err(SchemaError::Unknown("missing".into())));
        assert!(reg.raw("y").is_none());

        let a = CategorySchema {
            id: "a".into(),
            name: "A".into(),
            extends: Some("a".into()),
            ..Default::default()
        };
        assert!(matches!(reg.put(a), Err(SchemaError::Cycle(_))));
    }

    #[test]
    fn queries_find_their_category() {
        let reg = Registry::builtin();
        let t = |q: &str| crate::text::tokenize(q);
        assert_eq!(
            reg.detect(&t("beste handy unter 500")).as_deref(),
            Some("smartphone")
        );
        assert_eq!(
            reg.detect(&t("best mobile plan with 5g")).as_deref(),
            Some("mobile_plan")
        );
        assert_eq!(reg.detect(&t("laptop 16gb")).as_deref(), Some("laptop"));
        assert_eq!(reg.detect(&t("kaffeemaschine")), None);
    }

    #[test]
    fn schemas_round_trip_through_json() {
        let reg = Registry::builtin();
        let s = reg.resolved("smartphone").unwrap();
        let again: CategorySchema =
            serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(s, again);
    }
}
