pub mod ideas;
pub mod matcher;

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

pub use ideas::{IdeaError, IdeaGenerator, IdeaRequest, RecipeIdea};
pub use matcher::{MatchInput, RecipeMatch, RecipeMatcher};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ingredient {
    /// Key from `financer_core::CATALOG`.
    pub item: String,
    /// Human-readable amount, e.g. `250 g`.
    pub amount: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Recipe {
    pub id: String,
    pub title: String,
    pub minutes: u32,
    pub servings: u32,
    pub tags: Vec<String>,
    pub ingredients: Vec<Ingredient>,
    pub steps: Vec<String>,
}

impl Recipe {
    /// The recipes shipped with the app (German, everyday dishes).
    pub fn bundled() -> &'static [Recipe] {
        static RECIPES: OnceLock<Vec<Recipe>> = OnceLock::new();
        RECIPES.get_or_init(|| {
            serde_json::from_str(include_str!("../data/recipes.json"))
                .expect("bundled recipes.json is valid")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn bundled_recipes_are_well_formed() {
        let recipes = Recipe::bundled();
        assert!(recipes.len() >= 20);
        let mut ids = HashSet::new();
        for r in recipes {
            assert!(ids.insert(&r.id), "duplicate id {}", r.id);
            assert!(
                !r.title.is_empty() && r.minutes > 0 && r.servings > 0,
                "{}",
                r.id
            );
            assert!(!r.steps.is_empty() && !r.ingredients.is_empty(), "{}", r.id);
        }
    }

    #[test]
    fn every_ingredient_is_in_the_catalog() {
        for r in Recipe::bundled() {
            for ing in &r.ingredients {
                assert!(
                    financer_core::Catalog::by_key(&ing.item).is_some(),
                    "recipe {} uses unknown item {:?}",
                    r.id,
                    ing.item
                );
            }
        }
    }
}
