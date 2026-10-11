//! Persistence for user categorization rules, hand-made category corrections and split
//! transactions.
//!
//! Corrections and splits are keyed by the transaction's fingerprint (its stable identity),
//! not its database id, so they survive a backup restore that assigns new ids.

use std::collections::{HashMap, HashSet};

use financer_core::{
    AmountSign, Categorizer, Category, MatchKind, Money, NameNormalizer, RuleSet, SplitError,
    SplitPart, Splitter, Transaction, UserRule,
};
use sea_orm::sea_query::OnConflict;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder,
    TransactionTrait,
};

use crate::entity::transaction as tx_entity;
use crate::{EnumName, Store, StoreError, StoredTransaction};

mod rule_entity {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "categorization_rules")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        /// Lower runs first.
        pub priority: i32,
        pub pattern: String,
        /// Snake-case `MatchKind`.
        pub match_kind: String,
        /// Snake-case `AmountSign`, or none.
        pub sign: Option<String>,
        pub min_cents: Option<i64>,
        pub max_cents: Option<i64>,
        pub category: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

mod split_entity {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "transaction_splits")]
    pub struct Model {
        #[sea_orm(primary_key)]
        pub id: i64,
        pub transaction_fingerprint: String,
        pub position: i32,
        pub amount_cents: i64,
        pub category: String,
        pub note: Option<String>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

mod override_entity {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "transaction_category_overrides")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub transaction_fingerprint: String,
        pub category: String,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// The split of one stored transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSplit {
    pub transaction_id: i64,
    pub parts: Vec<SplitPart>,
}

/// A merchant whose transactions are still uncategorized (or `other`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownMerchant {
    /// The counterparty name after `NameNormalizer` (lowercase letters only).
    pub name: String,
    /// How many transactions carry it.
    pub count: usize,
}

/// Result of saving a split.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SplitOutcome {
    Saved,
    NotFound,
    Invalid(SplitError),
}

/// Row <-> domain conversions for this module.
struct Rows;

impl Rows {
    fn stored(r: tx_entity::Model) -> Result<(StoredTransaction, String), StoreError> {
        let category = match r.category {
            Some(name) => Some(EnumName::parse_category(&name)?),
            None => None,
        };
        Ok((
            StoredTransaction {
                id: r.id,
                transaction: Transaction {
                    booking_date: r.booking_date,
                    amount: Money::from_cents(r.amount_cents),
                    counterparty: r.counterparty,
                    purpose: r.purpose,
                    counterparty_iban: r.counterparty_iban,
                    category,
                },
            },
            r.fingerprint,
        ))
    }

    fn rule(r: rule_entity::Model) -> Result<UserRule, StoreError> {
        Ok(UserRule {
            id: r.id,
            pattern: r.pattern,
            kind: EnumName::from_name::<MatchKind>(&r.match_kind)?,
            sign: match r.sign {
                Some(s) => Some(EnumName::from_name::<AmountSign>(&s)?),
                None => None,
            },
            min: r.min_cents.map(Money::from_cents),
            max: r.max_cents.map(Money::from_cents),
            category: EnumName::parse_category(&r.category)?,
        })
    }

    fn rule_columns(rule: &UserRule) -> (String, Option<String>, Option<i64>, Option<i64>, String) {
        (
            EnumName::to_name(&rule.kind),
            rule.sign.as_ref().map(EnumName::to_name),
            rule.min.map(Money::cents),
            rule.max.map(Money::cents),
            EnumName::category_name(rule.category),
        )
    }

    fn part(r: split_entity::Model) -> Result<SplitPart, StoreError> {
        Ok(SplitPart {
            amount: Money::from_cents(r.amount_cents),
            category: EnumName::parse_category(&r.category)?,
            note: r.note,
        })
    }
}

impl Store {
    // ---- rules ----

    /// All rules in priority order (first match wins).
    pub async fn list_rules(&self) -> Result<Vec<UserRule>, StoreError> {
        rule_entity::Entity::find()
            .order_by_asc(rule_entity::Column::Priority)
            .order_by_asc(rule_entity::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(Rows::rule)
            .collect()
    }

    /// The categorizer new transactions go through on import and sync: the user's rules first,
    /// then the built-in ones.
    pub async fn categorizer(&self) -> Result<Categorizer, StoreError> {
        Ok(Categorizer::new().with_rules(RuleSet::new(self.list_rules().await?)))
    }

    /// Add `rule` (its `id` is ignored) after all existing rules.
    pub async fn add_rule(&self, rule: &UserRule) -> Result<UserRule, StoreError> {
        let last = rule_entity::Entity::find()
            .order_by_desc(rule_entity::Column::Priority)
            .one(&self.db)
            .await?
            .map_or(0, |r| r.priority.saturating_add(1));
        self.insert_rule(rule, last).await
    }

    async fn insert_rule(&self, rule: &UserRule, priority: i32) -> Result<UserRule, StoreError> {
        let (kind, sign, min, max, category) = Rows::rule_columns(rule);
        let row = rule_entity::ActiveModel {
            priority: Set(priority),
            pattern: Set(rule.pattern.trim().to_string()),
            match_kind: Set(kind),
            sign: Set(sign),
            min_cents: Set(min),
            max_cents: Set(max),
            category: Set(category),
            ..Default::default()
        }
        .insert(&self.db)
        .await?;
        Rows::rule(row)
    }

    /// Replace the fields of the rule with `rule.id`, keeping its place in the order. Returns
    /// `false` when there is no such rule.
    pub async fn update_rule(&self, rule: &UserRule) -> Result<bool, StoreError> {
        if rule_entity::Entity::find_by_id(rule.id)
            .one(&self.db)
            .await?
            .is_none()
        {
            return Ok(false);
        }
        let (kind, sign, min, max, category) = Rows::rule_columns(rule);
        rule_entity::ActiveModel {
            id: Set(rule.id),
            pattern: Set(rule.pattern.trim().to_string()),
            match_kind: Set(kind),
            sign: Set(sign),
            min_cents: Set(min),
            max_cents: Set(max),
            category: Set(category),
            ..Default::default()
        }
        .update(&self.db)
        .await?;
        Ok(true)
    }

    pub async fn delete_rule(&self, id: i64) -> Result<bool, StoreError> {
        Ok(rule_entity::Entity::delete_by_id(id)
            .exec(&self.db)
            .await?
            .rows_affected
            > 0)
    }

    /// Set the priority order: `ids` must list every rule exactly once, first = highest
    /// priority. Returns `false` (and changes nothing) when it does not.
    pub async fn reorder_rules(&self, ids: &[i64]) -> Result<bool, StoreError> {
        let txn = self.db.begin().await?;
        let existing: HashSet<i64> = rule_entity::Entity::find()
            .all(&txn)
            .await?
            .into_iter()
            .map(|r| r.id)
            .collect();
        let wanted: HashSet<i64> = ids.iter().copied().collect();
        if wanted.len() != ids.len() || wanted != existing {
            return Ok(false);
        }
        for (position, id) in ids.iter().enumerate() {
            rule_entity::ActiveModel {
                id: Set(*id),
                priority: Set(position as i32),
                ..Default::default()
            }
            .update(&txn)
            .await?;
        }
        txn.commit().await?;
        Ok(true)
    }

    /// Learn from a correction: make `counterparty` (any amount) belong to `category`. A
    /// previous "remember" rule for the same merchant is updated in place; a new one goes to
    /// the top so the correction wins over broader rules.
    pub async fn remember_merchant(
        &self,
        counterparty: &str,
        category: Category,
    ) -> Result<UserRule, StoreError> {
        let rules = self.list_rules().await?;
        if let Some(existing) = rules
            .iter()
            .find(|r| r.is_plain_merchant_rule(counterparty))
        {
            let mut updated = existing.clone();
            updated.category = category;
            self.update_rule(&updated).await?;
            return Ok(updated);
        }
        let top = rule_entity::Entity::find()
            .order_by_asc(rule_entity::Column::Priority)
            .one(&self.db)
            .await?
            .map_or(0, |r| r.priority.saturating_sub(1));
        self.insert_rule(
            &UserRule {
                id: 0,
                pattern: NameNormalizer::normalize(counterparty),
                kind: MatchKind::Equals,
                sign: None,
                min: None,
                max: None,
                category,
            },
            top,
        )
        .await
    }

    // ---- transactions: lookup, corrections, re-applying rules ----

    /// One transaction by id.
    pub async fn get_transaction(&self, id: i64) -> Result<Option<StoredTransaction>, StoreError> {
        tx_entity::Entity::find_by_id(id)
            .one(&self.db)
            .await?
            .map(|r| Rows::stored(r).map(|(t, _)| t))
            .transpose()
    }

    /// The user picks `category` for one transaction. The choice is remembered as a manual
    /// correction, so re-applying rules never overwrites it. `false` when there is no such
    /// transaction.
    pub async fn set_transaction_category(
        &self,
        id: i64,
        category: Category,
    ) -> Result<bool, StoreError> {
        let txn = self.db.begin().await?;
        let Some(row) = tx_entity::Entity::find_by_id(id).one(&txn).await? else {
            return Ok(false);
        };
        let name = EnumName::category_name(category);
        tx_entity::ActiveModel {
            id: Set(id),
            category: Set(Some(name.clone())),
            ..Default::default()
        }
        .update(&txn)
        .await?;
        override_entity::Entity::insert(override_entity::ActiveModel {
            transaction_fingerprint: Set(row.fingerprint),
            category: Set(name),
        })
        .on_conflict(
            OnConflict::column(override_entity::Column::TransactionFingerprint)
                .update_column(override_entity::Column::Category)
                .to_owned(),
        )
        .exec_without_returning(&txn)
        .await?;
        txn.commit().await?;
        Ok(true)
    }

    /// Run every transaction without a manual correction through `categorizer` again and store
    /// the result. Returns how many transactions changed category.
    pub async fn recategorize_all(&self, categorizer: &Categorizer) -> Result<usize, StoreError> {
        let txn = self.db.begin().await?;
        let manual: HashSet<String> = override_entity::Entity::find()
            .all(&txn)
            .await?
            .into_iter()
            .map(|o| o.transaction_fingerprint)
            .collect();
        let mut changed = 0usize;
        for row in tx_entity::Entity::find().all(&txn).await? {
            if manual.contains(&row.fingerprint) {
                continue;
            }
            let old = row.category.clone();
            let (stored, _) = Rows::stored(row)?;
            let new = EnumName::category_name(categorizer.categorize(&stored.transaction));
            if old.as_deref() == Some(new.as_str()) {
                continue;
            }
            tx_entity::ActiveModel {
                id: Set(stored.id),
                category: Set(Some(new)),
                ..Default::default()
            }
            .update(&txn)
            .await?;
            changed += 1;
        }
        txn.commit().await?;
        Ok(changed)
    }

    /// Re-apply the saved rules (and the built-in ones behind them) to existing transactions.
    pub async fn apply_rules(&self) -> Result<usize, StoreError> {
        let categorizer = self.categorizer().await?;
        self.recategorize_all(&categorizer).await
    }

    /// Merchants of expenses that are still uncategorized or `other` and have no manual
    /// correction or split, most frequent first, at most `limit`. Names are normalized, so
    /// nothing but letters leaves the store.
    pub async fn unknown_merchants(
        &self,
        limit: usize,
    ) -> Result<Vec<UnknownMerchant>, StoreError> {
        let manual: HashSet<String> = override_entity::Entity::find()
            .all(&self.db)
            .await?
            .into_iter()
            .map(|o| o.transaction_fingerprint)
            .collect();
        let split: HashSet<String> = split_entity::Entity::find()
            .all(&self.db)
            .await?
            .into_iter()
            .map(|s| s.transaction_fingerprint)
            .collect();
        let mut counts: HashMap<String, usize> = HashMap::new();
        for row in tx_entity::Entity::find().all(&self.db).await? {
            let unknown = matches!(row.category.as_deref(), None | Some("other"));
            if !unknown
                || row.amount_cents >= 0
                || manual.contains(&row.fingerprint)
                || split.contains(&row.fingerprint)
            {
                continue;
            }
            let name = NameNormalizer::normalize(&row.counterparty);
            if name.chars().count() >= 2 {
                *counts.entry(name).or_default() += 1;
            }
        }
        let mut out: Vec<UnknownMerchant> = counts
            .into_iter()
            .map(|(name, count)| UnknownMerchant { name, count })
            .collect();
        out.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
        out.truncate(limit);
        Ok(out)
    }

    // ---- splits ----

    /// Split transaction `id` into `parts`. The parts must add up to its amount exactly.
    pub async fn set_split(
        &self,
        id: i64,
        parts: &[SplitPart],
    ) -> Result<SplitOutcome, StoreError> {
        let txn = self.db.begin().await?;
        let Some(row) = tx_entity::Entity::find_by_id(id).one(&txn).await? else {
            return Ok(SplitOutcome::NotFound);
        };
        if let Err(e) = Splitter::validate(Money::from_cents(row.amount_cents), parts) {
            return Ok(SplitOutcome::Invalid(e));
        }
        split_entity::Entity::delete_many()
            .filter(split_entity::Column::TransactionFingerprint.eq(row.fingerprint.clone()))
            .exec(&txn)
            .await?;
        for (position, part) in parts.iter().enumerate() {
            split_entity::ActiveModel {
                transaction_fingerprint: Set(row.fingerprint.clone()),
                position: Set(position as i32),
                amount_cents: Set(part.amount.cents()),
                category: Set(EnumName::category_name(part.category)),
                note: Set(part
                    .note
                    .as_ref()
                    .map(|n| n.trim().to_string())
                    .filter(|n| !n.is_empty())),
                ..Default::default()
            }
            .insert(&txn)
            .await?;
        }
        txn.commit().await?;
        Ok(SplitOutcome::Saved)
    }

    /// Remove the split of transaction `id`. `false` when it had none (or does not exist).
    pub async fn clear_split(&self, id: i64) -> Result<bool, StoreError> {
        let Some(row) = tx_entity::Entity::find_by_id(id).one(&self.db).await? else {
            return Ok(false);
        };
        Ok(split_entity::Entity::delete_many()
            .filter(split_entity::Column::TransactionFingerprint.eq(row.fingerprint))
            .exec(&self.db)
            .await?
            .rows_affected
            > 0)
    }

    /// The split of one transaction, empty when it is not split.
    pub async fn get_split(&self, id: i64) -> Result<Vec<SplitPart>, StoreError> {
        let Some(row) = tx_entity::Entity::find_by_id(id).one(&self.db).await? else {
            return Ok(Vec::new());
        };
        split_entity::Entity::find()
            .filter(split_entity::Column::TransactionFingerprint.eq(row.fingerprint))
            .order_by_asc(split_entity::Column::Position)
            .order_by_asc(split_entity::Column::Id)
            .all(&self.db)
            .await?
            .into_iter()
            .map(Rows::part)
            .collect()
    }

    async fn splits_by_fingerprint(&self) -> Result<HashMap<String, Vec<SplitPart>>, StoreError> {
        let mut out: HashMap<String, Vec<SplitPart>> = HashMap::new();
        for row in split_entity::Entity::find()
            .order_by_asc(split_entity::Column::Position)
            .order_by_asc(split_entity::Column::Id)
            .all(&self.db)
            .await?
        {
            let fingerprint = row.transaction_fingerprint.clone();
            out.entry(fingerprint).or_default().push(Rows::part(row)?);
        }
        Ok(out)
    }

    /// Every split transaction with its parts.
    pub async fn list_splits(&self) -> Result<Vec<StoredSplit>, StoreError> {
        let mut by_fingerprint = self.splits_by_fingerprint().await?;
        if by_fingerprint.is_empty() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for row in tx_entity::Entity::find()
            .order_by_desc(tx_entity::Column::BookingDate)
            .order_by_desc(tx_entity::Column::Id)
            .all(&self.db)
            .await?
        {
            if let Some(parts) = by_fingerprint.remove(&row.fingerprint) {
                out.push(StoredSplit {
                    transaction_id: row.id,
                    parts,
                });
            }
        }
        Ok(out)
    }

    /// Transactions as category totals should see them: a split transaction is replaced by its
    /// parts (each with the part's amount and category), everything else is as stored. Use this
    /// for budget and spending sums; the plain list stays the record of what the bank booked.
    pub async fn list_effective_transactions(&self) -> Result<Vec<Transaction>, StoreError> {
        let splits = self.splits_by_fingerprint().await?;
        let mut out = Vec::new();
        for row in tx_entity::Entity::find()
            .order_by_desc(tx_entity::Column::BookingDate)
            .order_by_desc(tx_entity::Column::Id)
            .all(&self.db)
            .await?
        {
            let (stored, fingerprint) = Rows::stored(row)?;
            let parts = splits.get(&fingerprint).map_or(&[][..], Vec::as_slice);
            out.extend(Splitter::effective(&stored.transaction, parts));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    struct Fixture;

    impl Fixture {
        fn tx(counterparty: &str, cents: i64) -> Transaction {
            Transaction {
                booking_date: date!(2026 - 03 - 02),
                amount: Money::from_cents(cents),
                counterparty: counterparty.into(),
                purpose: "Kartenzahlung".into(),
                counterparty_iban: None,
                category: Some(Category::Other),
            }
        }

        async fn store() -> Store {
            let store = Store::connect("sqlite::memory:").await.unwrap();
            store
                .insert_new_transactions(&[
                    Self::tx("Kiosk Meier 12", -450),
                    Self::tx("Kiosk Meier 99", -300),
                    Self::tx("Zebra Laden", -1000),
                    Self::tx("Rewe", -5000),
                ])
                .await
                .unwrap();
            store
        }

        fn rule(pattern: &str, kind: MatchKind, category: Category) -> UserRule {
            UserRule {
                id: 0,
                pattern: pattern.into(),
                kind,
                sign: None,
                min: None,
                max: None,
                category,
            }
        }

        fn part(cents: i64, category: Category, note: Option<&str>) -> SplitPart {
            SplitPart {
                amount: Money::from_cents(cents),
                category,
                note: note.map(str::to_string),
            }
        }

        async fn id_of(store: &Store, counterparty: &str) -> i64 {
            store
                .list_transactions()
                .await
                .unwrap()
                .into_iter()
                .find(|t| t.transaction.counterparty.starts_with(counterparty))
                .unwrap()
                .id
        }
    }

    #[tokio::test]
    async fn rules_crud_order_and_reorder() {
        let store = Fixture::store().await;
        let a = store
            .add_rule(&Fixture::rule(
                "kiosk",
                MatchKind::Contains,
                Category::Dining,
            ))
            .await
            .unwrap();
        let b = store
            .add_rule(&Fixture::rule(
                "zebra",
                MatchKind::StartsWith,
                Category::Leisure,
            ))
            .await
            .unwrap();
        assert_eq!(
            store.list_rules().await.unwrap(),
            vec![a.clone(), b.clone()]
        );

        let mut edited = a.clone();
        edited.category = Category::Health;
        edited.min = Some(Money::from_cents(100));
        edited.sign = Some(AmountSign::Expense);
        assert!(store.update_rule(&edited).await.unwrap());
        assert_eq!(store.list_rules().await.unwrap()[0], edited);
        assert!(!store
            .update_rule(&UserRule {
                id: 999,
                ..edited.clone()
            })
            .await
            .unwrap());

        assert!(store.reorder_rules(&[b.id, a.id]).await.unwrap());
        let ids: Vec<i64> = store
            .list_rules()
            .await
            .unwrap()
            .iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec![b.id, a.id]);
        // not a permutation of the rules: nothing changes
        assert!(!store.reorder_rules(&[b.id]).await.unwrap());
        assert!(!store.reorder_rules(&[b.id, b.id]).await.unwrap());
        assert!(!store.reorder_rules(&[b.id, a.id, 42]).await.unwrap());

        assert!(store.delete_rule(a.id).await.unwrap());
        assert!(!store.delete_rule(a.id).await.unwrap());
        assert_eq!(store.list_rules().await.unwrap(), vec![b]);
    }

    #[tokio::test]
    async fn remember_creates_then_updates_one_rule_on_top() {
        let store = Fixture::store().await;
        store
            .add_rule(&Fixture::rule(
                "kiosk",
                MatchKind::Contains,
                Category::Dining,
            ))
            .await
            .unwrap();
        let first = store
            .remember_merchant("Kiosk Meier 12", Category::Shopping)
            .await
            .unwrap();
        assert_eq!(first.pattern, "kiosk meier");
        let again = store
            .remember_merchant("KIOSK MEIER 77", Category::Health)
            .await
            .unwrap();
        assert_eq!(again.id, first.id);
        let rules = store.list_rules().await.unwrap();
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].id, first.id, "the correction beats the broad rule");
        assert_eq!(rules[0].category, Category::Health);
    }

    #[tokio::test]
    async fn apply_rules_changes_matching_transactions_but_not_manual_ones() {
        let store = Fixture::store().await;
        store
            .add_rule(&Fixture::rule(
                "kiosk",
                MatchKind::Contains,
                Category::Dining,
            ))
            .await
            .unwrap();
        let manual = Fixture::id_of(&store, "Kiosk Meier 99").await;
        assert!(store
            .set_transaction_category(manual, Category::Leisure)
            .await
            .unwrap());
        // 1 kiosk changed; Rewe goes from `other` to groceries by the built-in rules
        assert_eq!(store.apply_rules().await.unwrap(), 2);
        let by_name: HashMap<String, Option<Category>> = store
            .list_transactions()
            .await
            .unwrap()
            .into_iter()
            .map(|t| (t.transaction.counterparty, t.transaction.category))
            .collect();
        assert_eq!(by_name["Kiosk Meier 12"], Some(Category::Dining));
        assert_eq!(by_name["Kiosk Meier 99"], Some(Category::Leisure));
        assert_eq!(by_name["Rewe"], Some(Category::Groceries));
        assert_eq!(by_name["Zebra Laden"], Some(Category::Other));
        // idempotent
        assert_eq!(store.apply_rules().await.unwrap(), 0);
        assert!(!store
            .set_transaction_category(9999, Category::Leisure)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn unknown_merchants_are_distinct_normalized_and_skip_corrected_ones() {
        let store = Fixture::store().await;
        let unknown = store.unknown_merchants(10).await.unwrap();
        // Rewe is stored as `other` here too (the fixture), so it is listed as well
        assert_eq!(
            unknown[0],
            UnknownMerchant {
                name: "kiosk meier".into(),
                count: 2
            }
        );
        assert_eq!(unknown.len(), 3);
        let rewe = Fixture::id_of(&store, "Rewe").await;
        store
            .set_transaction_category(rewe, Category::Other)
            .await
            .unwrap();
        let names: Vec<String> = store
            .unknown_merchants(2)
            .await
            .unwrap()
            .into_iter()
            .map(|m| m.name)
            .collect();
        assert_eq!(names, vec!["kiosk meier", "zebra laden"]);
    }

    #[tokio::test]
    async fn splits_validate_replace_and_feed_effective_transactions() {
        let store = Fixture::store().await;
        let id = Fixture::id_of(&store, "Rewe").await;
        let parts = vec![
            Fixture::part(-3000, Category::Groceries, Some("food")),
            Fixture::part(-2000, Category::Shopping, None),
        ];
        assert_eq!(
            store.set_split(id, &parts).await.unwrap(),
            SplitOutcome::Saved
        );
        assert_eq!(store.get_split(id).await.unwrap(), parts);
        assert_eq!(
            store.list_splits().await.unwrap(),
            vec![StoredSplit {
                transaction_id: id,
                parts: parts.clone()
            }]
        );

        // wrong sum is refused and the old split stays
        let bad = vec![
            Fixture::part(-3000, Category::Groceries, None),
            Fixture::part(-1000, Category::Shopping, None),
        ];
        assert!(matches!(
            store.set_split(id, &bad).await.unwrap(),
            SplitOutcome::Invalid(SplitError::SumMismatch { .. })
        ));
        assert_eq!(store.get_split(id).await.unwrap(), parts);
        assert_eq!(
            store.set_split(9999, &parts).await.unwrap(),
            SplitOutcome::NotFound
        );

        let effective = store.list_effective_transactions().await.unwrap();
        assert_eq!(effective.len(), 5); // 3 unsplit + 2 parts
        let total: i64 = effective.iter().map(|t| t.amount.cents()).sum();
        assert_eq!(total, -450 - 300 - 1000 - 5000);
        assert!(effective
            .iter()
            .any(|t| t.amount.cents() == -2000 && t.category == Some(Category::Shopping)));

        // a split transaction is not an unknown merchant; re-splitting replaces the parts
        let other = vec![
            Fixture::part(-4000, Category::Groceries, None),
            Fixture::part(-1000, Category::Dining, None),
        ];
        assert_eq!(
            store.set_split(id, &other).await.unwrap(),
            SplitOutcome::Saved
        );
        assert_eq!(store.get_split(id).await.unwrap(), other);
        assert!(store.clear_split(id).await.unwrap());
        assert!(!store.clear_split(id).await.unwrap());
        assert!(store.get_split(id).await.unwrap().is_empty());
        assert_eq!(store.list_effective_transactions().await.unwrap().len(), 4);
    }
}
