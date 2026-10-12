//! The weekly meal plan: one planned meal per day. A meal is either a bundled recipe (by id; its
//! ingredients come from the dataset) or a custom one (title plus ingredients as JSON, e.g. an
//! idea from the language model).

use sea_orm::{
    ActiveValue::Set, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, TransactionTrait,
};
use time::Date;

use crate::{Store, StoreError};

mod meal_plan_day {
    use sea_orm::entity::prelude::*;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
    #[sea_orm(table_name = "meal_plan_days")]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub plan_date: TimeDate,
        pub recipe_id: Option<String>,
        pub title: String,
        pub servings: i32,
        /// Servings the ingredient amounts are written for.
        pub base_servings: i32,
        /// Ingredients of a custom meal; the API layer owns the shape.
        pub ingredients_json: Option<String>,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// A planned meal as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredMealDay {
    pub date: Date,
    /// Set for bundled recipes.
    pub recipe_id: Option<String>,
    pub title: String,
    pub servings: u32,
    pub base_servings: u32,
    /// JSON list of ingredients for custom meals.
    pub ingredients_json: Option<String>,
}

impl Store {
    /// Planned meals from `start` to `end`, both inclusive, oldest first.
    pub async fn meal_plan(
        &self,
        start: Date,
        end: Date,
    ) -> Result<Vec<StoredMealDay>, StoreError> {
        Ok(meal_plan_day::Entity::find()
            .filter(meal_plan_day::Column::PlanDate.gte(start))
            .filter(meal_plan_day::Column::PlanDate.lte(end))
            .order_by_asc(meal_plan_day::Column::PlanDate)
            .all(&self.db)
            .await?
            .into_iter()
            .map(|r| StoredMealDay {
                date: r.plan_date,
                recipe_id: r.recipe_id,
                title: r.title,
                servings: r.servings.max(1) as u32,
                base_servings: r.base_servings.max(1) as u32,
                ingredients_json: r.ingredients_json,
            })
            .collect())
    }

    /// Replace everything planned from `start` to `end` (inclusive) with `days`.
    pub async fn replace_meal_plan(
        &self,
        start: Date,
        end: Date,
        days: &[StoredMealDay],
    ) -> Result<(), StoreError> {
        let txn = self.db.begin().await?;
        meal_plan_day::Entity::delete_many()
            .filter(meal_plan_day::Column::PlanDate.gte(start))
            .filter(meal_plan_day::Column::PlanDate.lte(end))
            .exec(&txn)
            .await?;
        for d in days {
            meal_plan_day::Entity::insert(meal_plan_day::ActiveModel {
                plan_date: Set(d.date),
                recipe_id: Set(d.recipe_id.clone()),
                title: Set(d.title.clone()),
                servings: Set(d.servings as i32),
                base_servings: Set(d.base_servings as i32),
                ingredients_json: Set(d.ingredients_json.clone()),
            })
            .exec_without_returning(&txn)
            .await?;
        }
        txn.commit().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    fn day(d: Date, recipe: Option<&str>, servings: u32) -> StoredMealDay {
        StoredMealDay {
            date: d,
            recipe_id: recipe.map(str::to_string),
            title: "Nudeln".into(),
            servings,
            base_servings: 2,
            ingredients_json: recipe.is_none().then(|| "[]".to_string()),
        }
    }

    #[tokio::test]
    async fn plan_is_replaced_per_range_and_other_weeks_stay() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let (w1, w1_end) = (date!(2026 - 10 - 12), date!(2026 - 10 - 18));
        let (w2, w2_end) = (date!(2026 - 10 - 19), date!(2026 - 10 - 25));
        store
            .replace_meal_plan(
                w1,
                w1_end,
                &[
                    day(date!(2026 - 10 - 13), Some("spaghetti"), 2),
                    day(date!(2026 - 10 - 18), None, 4),
                ],
            )
            .await
            .unwrap();
        store
            .replace_meal_plan(w2, w2_end, &[day(date!(2026 - 10 - 19), Some("x"), 1)])
            .await
            .unwrap();

        let first = store.meal_plan(w1, w1_end).await.unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].recipe_id.as_deref(), Some("spaghetti"));
        assert_eq!(first[1].ingredients_json.as_deref(), Some("[]"));
        assert_eq!(first[1].servings, 4);

        // saving week 1 again replaces it and leaves week 2 alone
        store
            .replace_meal_plan(w1, w1_end, &[day(date!(2026 - 10 - 14), Some("b"), 3)])
            .await
            .unwrap();
        let again = store.meal_plan(w1, w1_end).await.unwrap();
        assert_eq!(again.len(), 1);
        assert_eq!(again[0].date, date!(2026 - 10 - 14));
        assert_eq!(store.meal_plan(w2, w2_end).await.unwrap().len(), 1);

        // clearing the week
        store.replace_meal_plan(w1, w1_end, &[]).await.unwrap();
        assert!(store.meal_plan(w1, w1_end).await.unwrap().is_empty());
    }
}
