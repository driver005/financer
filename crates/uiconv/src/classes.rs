//! `uiconv classes`: reads every Tailwind class in Medusa's components and reports what maps to a
//! token of packages/ui and what does not. The unmapped list is the to-do list for new tokens.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use oxc_allocator::Allocator;
use oxc_ast::ast::{CallExpression, Expression, JSXAttribute, JSXAttributeName, ObjectProperty, PropertyKey, StringLiteral, TemplateElement};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::tailwind::{map_class, Outcome};
use crate::tokens::Tokens;

/// Calls whose string arguments are class lists.
const CLASS_FUNCTIONS: &[&str] = &["cva", "clx", "cn", "cx", "twMerge"];

/// One-word utilities. Any other bare word in a class call is a variant name ("base", "small").
const SINGLE: &[&str] = &[
    "flex", "grid", "block", "inline", "hidden", "border", "rounded", "truncate", "relative", "absolute", "fixed", "sticky", "static",
    "grow", "shrink", "group", "peer", "contents", "transition", "antialiased", "shadow", "outline", "ring", "underline", "uppercase",
    "capitalize", "lowercase", "italic", "inline-flex", "inline-block", "sr-only", "container",
];

fn is_class_like(c: &str) -> bool {
    c.contains(['-', ':', '[']) || SINGLE.contains(&c)
}

#[derive(Default)]
struct Collector {
    depth: u32,
    classes: Vec<String>,
}

impl Collector {
    fn add(&mut self, text: &str) {
        if self.depth > 0 {
            self.classes.extend(text.split_whitespace().filter(|c| is_class_like(c)).map(str::to_string));
        }
    }
}

impl<'a> Visit<'a> for Collector {
    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        let is_class_fn = matches!(&call.callee, Expression::Identifier(i) if CLASS_FUNCTIONS.contains(&i.name.as_str()));
        if is_class_fn {
            self.depth += 1;
        }
        oxc_ast_visit::walk::walk_call_expression(self, call);
        if is_class_fn {
            self.depth -= 1;
        }
    }
    fn visit_jsx_attribute(&mut self, attr: &JSXAttribute<'a>) {
        let is_class = matches!(&attr.name, JSXAttributeName::Identifier(i) if i.name == "className");
        if is_class {
            self.depth += 1;
        }
        oxc_ast_visit::walk::walk_jsx_attribute(self, attr);
        if is_class {
            self.depth -= 1;
        }
    }
    fn visit_object_property(&mut self, prop: &ObjectProperty<'a>) {
        // `defaultVariants: { size: "base" }` holds variant names, not classes
        if matches!(&prop.key, PropertyKey::StaticIdentifier(i) if i.name == "defaultVariants") {
            return;
        }
        // the key of a variant (`"2xsmall": "h-5"`) is a name; only the value is classes
        self.visit_expression(&prop.value);
    }
    fn visit_string_literal(&mut self, lit: &StringLiteral<'a>) {
        self.add(lit.value.as_str());
    }
    fn visit_template_element(&mut self, el: &TemplateElement<'a>) {
        self.add(el.value.raw.as_str());
    }
}

fn tsx_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            if p.file_name().is_some_and(|n| n == "__tests__") {
                continue;
            }
            tsx_files(&p, out);
        } else if p.extension().is_some_and(|x| x == "tsx") && !p.to_string_lossy().contains(".spec.") {
            out.push(p);
        }
    }
}

pub fn classes_of(source: &str) -> Result<Vec<String>, String> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
    if !parsed.diagnostics.is_empty() {
        return Err(format!("parse: {}", parsed.diagnostics[0]));
    }
    let mut c = Collector::default();
    c.visit_program(&parsed.program);
    Ok(c.classes)
}

pub fn run(ui_src: &Path, constants: &Path) -> Result<(), String> {
    let tokens = Tokens::load(constants)?;
    let mut files = Vec::new();
    tsx_files(ui_src, &mut files);
    files.sort();

    let (mut mapped, mut ignored, mut deferred) = (0usize, 0usize, 0usize);
    let mut unmapped: BTreeMap<String, usize> = BTreeMap::new();
    let mut deferred_kinds: BTreeMap<String, usize> = BTreeMap::new();
    for f in &files {
        let source = fs::read_to_string(f).map_err(|e| format!("{}: {e}", f.display()))?;
        for class in classes_of(&source).map_err(|e| format!("{}: {e}", f.display()))? {
            match map_class(&tokens, &class) {
                Outcome::Prop { .. } => mapped += 1,
                Outcome::Ignored(_) => ignored += 1,
                Outcome::Deferred(d) => {
                    deferred += 1;
                    *deferred_kinds.entry(d.split(':').next().unwrap_or("").to_string()).or_default() += 1;
                }
                Outcome::Unmapped(reason) => *unmapped.entry(reason).or_default() += 1,
            }
        }
    }
    let unmapped_total: usize = unmapped.values().sum();
    println!("{} files, {} classes", files.len(), mapped + ignored + deferred + unmapped_total);
    println!("  mapped to a token prop  {mapped}");
    println!("  web-only (ignored)      {ignored}");
    println!("  states (for the port)   {deferred}");
    println!("  unmapped                {unmapped_total}");
    println!("\nstates by variant:");
    let mut kinds: Vec<_> = deferred_kinds.into_iter().collect();
    kinds.sort_by(|a, b| b.1.cmp(&a.1));
    for (k, n) in kinds.iter().take(15) {
        println!("  {n:>5}  {k}");
    }
    println!("\nunmapped, most used first (each line is a token or a rule still missing):");
    let mut list: Vec<_> = unmapped.into_iter().collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    for (reason, n) in list.iter().take(60) {
        println!("  {n:>5}  {reason}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_classes_from_cva_clx_and_class_name_but_not_variant_names() {
        let src = r#"
const v = cva({ base: "flex gap-2", variants: { size: { "2xsmall": "h-5 px-1", base: "h-8" } }, defaultVariants: { size: "base" } })
const A = () => <span className={clx(v({ size }), "rounded-md", cond && "p-4")} title="not a class" />
"#;
        let c = classes_of(src).unwrap();
        assert_eq!(c, ["flex", "gap-2", "h-5", "px-1", "h-8", "rounded-md", "p-4"]);
    }
}
