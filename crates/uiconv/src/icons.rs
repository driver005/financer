//! Medusa icons: `React.forwardRef` components that return one `<svg>`. We read the `<svg>` tree
//! with a real TSX parser and keep it as data (tag, attributes, children).

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild, JSXElement, JSXElementName, JSXExpression,
    UnaryOperator,
};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;
use serde_json::{json, Map, Value};

/// Elements react-native-svg draws. Everything else is an error, so nothing is dropped silently,
/// except filters (see `is_filter`).
const TAGS: &[&str] = &["svg", "g", "path", "circle", "rect", "defs", "clipPath", "linearGradient", "stop"];
/// Attributes that are the host's business, not the drawing's.
const SKIP_ATTRS: &[&str] = &["xmlns", "ref", "fill-rule"];

/// SVG filters (blur, colour matrix, ...) are skipped: react-native-svg only supports them on the
/// new architecture, and Medusa uses them for a few glow effects in decorative icons.
fn is_filter(tag: &str) -> bool {
    tag == "filter" || tag.starts_with("fe")
}

struct Finder<'a> {
    found: Option<Result<Value, String>>,
    source: &'a str,
}

impl<'a> Visit<'a> for Finder<'a> {
    fn visit_jsx_element(&mut self, el: &JSXElement<'a>) {
        if self.found.is_some() {
            return;
        }
        if tag_name(&el.opening_element.name).as_deref() == Some("svg") {
            self.found = Some(node(el, self.source, true).map(|n| n.unwrap_or(Value::Null)));
            return;
        }
        oxc_ast_visit::walk::walk_jsx_element(self, el);
    }
}

fn tag_name(name: &JSXElementName) -> Option<String> {
    match name {
        JSXElementName::Identifier(i) => Some(i.name.to_string()),
        JSXElementName::IdentifierReference(i) => Some(i.name.to_string()),
        _ => None,
    }
}

/// An attribute value as JSON. `{color}` becomes the marker "$color", replaced by the tone at render.
fn value(v: &JSXAttributeValue, attr: &str) -> Result<Value, String> {
    match v {
        JSXAttributeValue::StringLiteral(s) => Ok(json!(s.value.as_str())),
        JSXAttributeValue::ExpressionContainer(c) => match &c.expression {
            JSXExpression::NumericLiteral(n) => Ok(number(n.value)),
            JSXExpression::StringLiteral(s) => Ok(json!(s.value.as_str())),
            JSXExpression::Identifier(i) if i.name == "color" => Ok(json!("$color")),
            JSXExpression::UnaryExpression(u) if u.operator == UnaryOperator::UnaryNegation => match &u.argument {
                oxc_ast::ast::Expression::NumericLiteral(n) => Ok(number(-n.value)),
                _ => Err(format!("attribute {attr}: unsupported negation")),
            },
            _ => Err(format!("attribute {attr}: unsupported expression")),
        },
        _ => Err(format!("attribute {attr}: unsupported value")),
    }
}

fn number(n: f64) -> Value {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

/// `None` for a skipped element (a filter). `root` keeps width, height and viewBox.
fn node(el: &JSXElement, source: &str, root: bool) -> Result<Option<Value>, String> {
    let tag = tag_name(&el.opening_element.name).ok_or("unsupported element name")?;
    if is_filter(&tag) {
        return Ok(None);
    }
    if !TAGS.contains(&tag.as_str()) {
        return Err(format!("unsupported element <{tag}>"));
    }
    let mut attrs = Map::new();
    for item in &el.opening_element.attributes {
        let JSXAttributeItem::Attribute(a) = item else { continue }; // {...props}: the host's
        let JSXAttributeName::Identifier(name) = &a.name else { return Err("namespaced attribute".into()) };
        let name = name.name.as_str();
        if SKIP_ATTRS.contains(&name) || (root && name == "fill") {
            continue;
        }
        if name == "filter" || name == "style" {
            continue; // refers to a skipped filter; style is only a blend mode, which react-native-svg lacks
        }
        if let Some(v) = &a.value {
            attrs.insert(name.to_string(), value(v, name)?);
        }
    }
    let mut kids = Vec::new();
    for child in &el.children {
        match child {
            JSXChild::Element(e) => {
                if let Some(n) = node(e, source, false)? {
                    kids.push(n);
                }
            }
            JSXChild::Text(t) if t.value.trim().is_empty() => {}
            _ => return Err(format!("unsupported child in <{tag}>")),
        }
    }
    let mut out = Map::new();
    out.insert("t".into(), json!(tag));
    if !attrs.is_empty() {
        out.insert("a".into(), Value::Object(attrs));
    }
    if !kids.is_empty() {
        out.insert("c".into(), Value::Array(kids));
    }
    Ok(Some(Value::Object(out)))
}

/// Parse one icon file into `{ w, h, vb, n }`.
fn convert(path: &Path) -> Result<Value, String> {
    let source = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &source, SourceType::tsx()).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(format!("parse: {}", parsed.diagnostics[0]));
    }
    let mut finder = Finder { found: None, source: &source };
    finder.visit_program(&parsed.program);
    let svg = finder.found.ok_or("no <svg>")??;
    let attrs = svg.get("a").and_then(Value::as_object).ok_or("<svg> has no attributes")?;
    let get = |k: &str| attrs.get(k).cloned().ok_or(format!("<svg> has no {k}"));
    Ok(json!({ "w": get("width")?, "h": get("height")?, "vb": get("viewBox")?, "n": svg.get("c").cloned().unwrap_or(json!([])) }))
}

pub fn run(src: &Path, out: &Path) -> Result<(), String> {
    let mut icons: BTreeMap<String, Value> = BTreeMap::new();
    let mut failures = Vec::new();
    for dir in ["components", "custom"] {
        let Ok(entries) = fs::read_dir(src.join(dir)) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("tsx") {
                continue;
            }
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            match convert(&path) {
                Ok(v) => {
                    icons.insert(name, v);
                }
                Err(e) => failures.push(format!("{}: {e}", path.display())),
            }
        }
    }
    if !failures.is_empty() {
        return Err(format!("{} icons failed:\n{}", failures.len(), failures.join("\n")));
    }
    let mut text = String::from(HEADER);
    text.push_str("export const medusaIcons = {\n");
    for (name, v) in &icons {
        text.push_str(&format!("  {}: {},\n", json!(name), v));
    }
    text.push_str("} as const satisfies Record<string, SvgIcon>;\n\nexport type MedusaIconName = keyof typeof medusaIcons;\n");
    fs::write(out, text).map_err(|e| e.to_string())?;
    eprintln!("uiconv: {} icons -> {}", icons.len(), out.display());
    Ok(())
}

const HEADER: &str = r#"// GENERATED by crates/uiconv from the Medusa icon set (MIT). Do not edit; run `make ui-icons`.
// SVG geometry is data, so it lives here with the other raw numbers.

/** One SVG element: tag, attributes ("$color" is replaced by the tone), children. */
export type SvgNode = { readonly t: string; readonly a?: Readonly<Record<string, string | number>>; readonly c?: readonly SvgNode[] };

/** An icon: its drawing size (w, h), viewBox and elements. */
export type SvgIcon = { readonly w: number; readonly h: number; readonly vb: string; readonly n: readonly SvgNode[] };

"#;
