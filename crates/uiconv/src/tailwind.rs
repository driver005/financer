//! Maps one Tailwind class (as Medusa writes them) to a token prop of packages/ui.
//!
//! Nothing is guessed: a class either becomes a token prop, is web-only (ignored), is a state
//! (hover, focus, ...: for the person porting the component), or is unmapped with the reason.
//! The unmapped reasons are the to-do list for new tokens.

use crate::tokens::Tokens;

#[derive(Debug, PartialEq, Eq, Clone)]
pub enum Outcome {
    /// A token prop on Box or Text: `p="md"`, `radius="full"`, `variant="badge"`, `tone="muted"`.
    Prop { name: String, value: String },
    /// Web-only (cursor, transition, outline): nothing to do on a phone.
    Ignored(String),
    /// Behind a variant (hover:, focus:, dark:, [&_svg]:, data-[...]:): for the person porting.
    Deferred(String),
    /// No token yet; the reason says which one is missing.
    Unmapped(String),
}

fn prop(name: &str, value: &str) -> Outcome {
    Outcome::Prop { name: name.into(), value: value.into() }
}

/// Splits `hover:bg-ui-bg-base` into (["hover"], "bg-ui-bg-base"), not splitting inside `[...]`.
fn split_variants(class: &str) -> (Vec<&str>, &str) {
    let mut depth = 0;
    let mut start = 0;
    let mut variants = Vec::new();
    for (i, c) in class.char_indices() {
        match c {
            '[' => depth += 1,
            ']' => depth -= 1,
            ':' if depth == 0 => {
                variants.push(&class[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    (variants, &class[start..])
}

fn tone_of(color: &str) -> Option<&'static str> {
    Some(match color {
        "green" => "success",
        "red" => "danger",
        "blue" => "info",
        "orange" => "warning",
        "purple" => "accent",
        "neutral" | "grey" => "neutral",
        _ => return None,
    })
}

/// A Medusa `ui-*` role as a colour role of packages/ui: (kind, token), kind is "bg", "fg" or "border".
fn role(name: &str) -> Result<(&'static str, String), String> {
    let name = name.strip_prefix("ui-").ok_or_else(|| format!("raw colour `{name}`"))?;
    if let Some(rest) = name.strip_prefix("tag-") {
        let (color, part) = rest.rsplit_once('-').ok_or("bad tag role")?;
        let tone = tone_of(color).ok_or_else(|| format!("tag colour `{color}`"))?;
        return Ok(match part {
            "bg" => ("bg", format!("{tone}-soft")),
            "text" => ("fg", format!("on-{tone}-soft")),
            "icon" => ("fg", tone.to_string()),
            "border" => ("border", tone.to_string()),
            _ => return Err(format!("tag part `{part}`")),
        });
    }
    if name.starts_with("contrast-") || name.starts_with("button-") {
        return Err(format!("role `ui-{name}` has no counterpart (inverted or button fills)"));
    }
    let base = name.trim_end_matches("-hover").trim_end_matches("-pressed");
    let state = base.len() != name.len();
    let found = match base {
        "bg-base" => ("bg", "surface"),
        "bg-subtle" => ("bg", "background"),
        "bg-field" => ("bg", "field"),
        "bg-component" => ("bg", "sunken"),
        "bg-interactive" => ("bg", "accent-solid"),
        "bg-overlay" => ("bg", "scrim"),
        "bg-disabled" | "bg-switch-off" => ("bg", "sunken"),
        "fg-base" => ("fg", "default"),
        "fg-subtle" => ("fg", "muted"),
        "fg-muted" | "fg-disabled" => ("fg", "subtle"),
        "fg-on-color" => ("fg", "on-accent-solid"),
        "fg-on-inverted" => ("fg", "inverse"),
        "fg-interactive" => ("fg", "accent"),
        "fg-error" => ("fg", "danger"),
        "border-base" | "border-component" => ("border", "default"),
        "border-strong" => ("border", "strong"),
        "border-interactive" => ("border", "focus"),
        "border-error" => ("border", "danger"),
        _ => return Err(format!("role `ui-{name}` has no counterpart")),
    };
    if state {
        return Err(format!("state colour `ui-{name}` (needs hover/pressed support)"));
    }
    Ok((found.0, found.1.to_string()))
}

/// `txt-compact-small-plus` -> (px, weight).
fn txt(name: &str) -> Option<(u32, u32)> {
    let rest = name.strip_prefix("txt-")?;
    let rest = rest.strip_prefix("compact-").unwrap_or(rest);
    let (size, plus) = match rest.strip_suffix("-plus") {
        Some(s) => (s, true),
        None => (rest, false),
    };
    let px = match size {
        "xsmall" => 12,
        "small" => 13,
        "medium" => 14,
        "large" => 16,
        "xlarge" => 18,
        _ => return None,
    };
    Some((px, if plus { 500 } else { 400 }))
}

/// The text variant of packages/ui with this size and weight.
fn variant_for(px: u32, weight: u32) -> Option<&'static str> {
    Some(match (px, weight) {
        (12, 400) => "caption",
        (12, 500) => "badge",
        (13, 400) => "compact",
        (13, 500) => "compactStrong",
        (14, 400) => "bodySmall",
        (14, 500) => "label",
        (16, 400) => "body",
        (16, 500) => "control",
        (18, 500) => "controlLarge",
        _ => return None,
    })
}

fn px_of(tokens: &Tokens, value: &str) -> Option<f64> {
    if let Some(inner) = value.strip_prefix('[').and_then(|v| v.strip_suffix(']')) {
        return inner.strip_suffix("px").and_then(|n| n.parse().ok());
    }
    tokens.spacing.get(value).copied()
}

/// Map one class, with its variants.
pub fn map_class(tokens: &Tokens, class: &str) -> Outcome {
    let (variants, base) = split_variants(class);
    if !variants.is_empty() {
        return Outcome::Deferred(format!("{}: {base}", variants.join(":")));
    }
    let base = base.trim_start_matches('!');
    let negative = base.starts_with('-');
    let base = base.trim_start_matches('-');

    // text, colour, border, shadow
    if let Some((px, weight)) = txt(base) {
        return match variant_for(px, weight) {
            Some(v) => prop("variant", v),
            None => Outcome::Unmapped(format!("text variant of {px}px / weight {weight}")),
        };
    }
    if let Some(color) = base.strip_prefix("text-") {
        if color.starts_with("ui-") {
            return match role(color) {
                Ok(("fg", t)) => prop("tone", &t),
                Ok(_) => Outcome::Unmapped(format!("text colour from a {color} role")),
                Err(e) => Outcome::Unmapped(e),
            };
        }
        if matches!(color, "left" | "center" | "right") {
            return prop("align", color);
        }
        return Outcome::Unmapped(format!("text utility `{base}`: use a text variant"));
    }
    if let Some(color) = base.strip_prefix("bg-") {
        return match role(color) {
            Ok(("bg", t)) => prop("bg", &t),
            Ok(_) => Outcome::Unmapped(format!("background from `{color}`")),
            Err(e) => Outcome::Unmapped(e),
        };
    }
    match base {
        "border" => return prop("border", "hairline"),
        "border-0" => return prop("border", "none"),
        "border-2" => return prop("border", "thick"),
        "shadow-none" => return prop("shadow", "none"),
        "shadow-sm" | "shadow-md" | "shadow-lg" | "shadow-xl" => return prop("shadow", &base[7..]),
        "rounded" => return prop("radius", "base"),
        "overflow-hidden" => return prop("overflow", "hidden"),
        "overflow-visible" => return prop("overflow", "visible"),
        "truncate" => return prop("numberOfLines", "1"),
        _ => {}
    }
    if let Some(color) = base.strip_prefix("border-") {
        if color.starts_with("ui-") {
            return match role(color) {
                Ok(("border", t)) => prop("borderTone", &t),
                Ok(_) => Outcome::Unmapped(format!("border colour from `{color}`")),
                Err(e) => Outcome::Unmapped(e),
            };
        }
        return Outcome::Unmapped(format!("border utility `{base}`"));
    }
    if base.starts_with("shadow-") {
        return Outcome::Unmapped(format!("elevation `{base}` (Medusa's own shadows)"));
    }
    if let Some(r) = base.strip_prefix("rounded-") {
        return if tokens.radius.contains_key(r) { prop("radius", r) } else { Outcome::Unmapped(format!("radius `{r}`")) };
    }

    // spacing: p, px, m, gap, ...
    for (prefix, name) in [
        ("px-", "px"), ("py-", "py"), ("pt-", "pt"), ("pr-", "pr"), ("pb-", "pb"), ("pl-", "pl"), ("p-", "p"),
        ("mx-", "mx"), ("my-", "my"), ("mt-", "mt"), ("mr-", "mr"), ("mb-", "mb"), ("ml-", "ml"), ("m-", "m"),
        ("gap-x-", "gap"), ("gap-y-", "gap"), ("gap-", "gap"),
    ] {
        if let Some(v) = base.strip_prefix(prefix) {
            if v == "auto" {
                return Outcome::Unmapped(format!("`{base}`: auto margin"));
            }
            let Some(px) = px_of(tokens, v) else { return Outcome::Unmapped(format!("`{base}`: unknown spacing")) };
            if negative {
                return Outcome::Unmapped(format!("`-{base}`: negative spacing"));
            }
            return match tokens.space_by_px.get(&(px as i64)) {
                Some(step) => prop(name, step),
                None => Outcome::Unmapped(format!("space of {px}px (`{base}`)")),
            };
        }
    }
    // sizes
    for prefix in ["size-", "h-", "w-", "min-h-", "min-w-", "max-h-", "max-w-"] {
        if let Some(v) = base.strip_prefix(prefix) {
            if v == "full" && prefix == "w-" {
                return prop("full", "true");
            }
            return match px_of(tokens, v) {
                Some(px) => Outcome::Unmapped(format!("size of {px}px (`{prefix}*`)")),
                None => Outcome::Unmapped(format!("size `{base}`")),
            };
        }
    }

    match base {
        "flex" | "inline-flex" => prop("layout", "flex"),
        "flex-col" => prop("direction", "column"),
        "flex-row" => prop("direction", "row"),
        "flex-wrap" => prop("wrap", "true"),
        "flex-1" | "grow" | "flex-grow" => prop("grow", "true"),
        "shrink" | "flex-shrink" => prop("shrink", "true"),
        "items-center" => prop("align", "center"),
        "items-start" => prop("align", "start"),
        "items-end" => prop("align", "end"),
        "items-stretch" => prop("align", "stretch"),
        "items-baseline" => prop("align", "baseline"),
        "justify-center" => prop("justify", "center"),
        "justify-start" => prop("justify", "start"),
        "justify-end" => prop("justify", "end"),
        "justify-between" => prop("justify", "between"),
        "justify-around" => prop("justify", "around"),
        "box-border" | "select-none" | "outline-none" | "appearance-none" | "sr-only" | "pointer-events-none" | "list-none" => {
            Outcome::Ignored(base.into())
        }
        _ if ["transition", "duration-", "ease-", "cursor-", "outline-", "ring-", "focus", "animate-", "backdrop-", "will-change", "select-", "whitespace-", "antialiased", "motion-"]
            .iter()
            .any(|p| base.starts_with(p)) =>
        {
            Outcome::Ignored(base.into())
        }
        "relative" | "absolute" | "fixed" | "sticky" | "inset-0" => Outcome::Unmapped(format!("position `{base}`")),
        "block" | "inline-block" | "inline" | "hidden" | "grid" | "inline-grid" => Outcome::Unmapped(format!("display `{base}`")),
        _ => Outcome::Unmapped(format!("class `{base}`")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens() -> Tokens {
        Tokens::parse(
            "export const spacing = { 0: 0, px: 1, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 2.5: 10, 3: 12, 4: 16 } as const;\nexport const space = { none: spacing[0], \"2xs\": spacing[0.5], xs: spacing[1], snug: spacing[1.5], sm: spacing[2], md: spacing[3], lg: spacing[4] } as const;",
            "export const radius = { none: 0, sm: 2, base: 4, md: 6, lg: 8, full: 9999 } as const;",
        )
    }

    #[test]
    fn spacing_becomes_a_step() {
        let t = tokens();
        assert_eq!(map_class(&t, "px-3"), prop("px", "md"));
        assert_eq!(map_class(&t, "gap-x-0.5"), prop("gap", "2xs"));
        assert_eq!(map_class(&t, "py-[8px]"), prop("py", "sm"));
    }

    #[test]
    fn spacing_without_a_step_says_which_size_is_missing() {
        let t = tokens();
        assert_eq!(map_class(&t, "px-2.5"), Outcome::Unmapped("space of 10px (`px-2.5`)".into()));
        assert_eq!(map_class(&t, "py-1.5"), prop("py", "snug"));
        assert_eq!(map_class(&t, "py-px"), Outcome::Unmapped("space of 1px (`py-px`)".into()));
    }

    #[test]
    fn radius_and_borders() {
        let t = tokens();
        assert_eq!(map_class(&t, "rounded-md"), prop("radius", "md"));
        assert_eq!(map_class(&t, "rounded-full"), prop("radius", "full"));
        assert_eq!(map_class(&t, "border"), prop("border", "hairline"));
    }

    #[test]
    fn medusa_tag_roles_become_tones() {
        let t = tokens();
        assert_eq!(map_class(&t, "bg-ui-tag-green-bg"), prop("bg", "success-soft"));
        assert_eq!(map_class(&t, "text-ui-tag-red-text"), prop("tone", "on-danger-soft"));
        assert_eq!(map_class(&t, "border-ui-tag-blue-border"), prop("borderTone", "info"));
        assert_eq!(map_class(&t, "text-ui-fg-subtle"), prop("tone", "muted"));
    }

    #[test]
    fn text_utilities_pick_a_variant_or_ask_for_one() {
        let t = tokens();
        assert_eq!(map_class(&t, "txt-compact-xsmall-plus"), prop("variant", "badge"));
        assert_eq!(map_class(&t, "txt-compact-large-plus"), prop("variant", "control"));
        assert_eq!(map_class(&t, "txt-compact-small-plus"), prop("variant", "compactStrong"));
        assert_eq!(map_class(&t, "txt-compact-medium"), prop("variant", "bodySmall"));
        assert_eq!(map_class(&t, "txt-compact-xlarge"), Outcome::Unmapped("text variant of 18px / weight 400".into()));
    }

    #[test]
    fn states_are_deferred_and_web_only_is_ignored() {
        let t = tokens();
        assert_eq!(map_class(&t, "hover:bg-ui-bg-base-hover"), Outcome::Deferred("hover: bg-ui-bg-base-hover".into()));
        assert_eq!(map_class(&t, "[&_svg]:text-ui-tag-green-icon"), Outcome::Deferred("[&_svg]: text-ui-tag-green-icon".into()));
        assert_eq!(map_class(&t, "transition-fg"), Outcome::Ignored("transition-fg".into()));
        assert_eq!(map_class(&t, "cursor-pointer"), Outcome::Ignored("cursor-pointer".into()));
    }
}
