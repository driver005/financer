//! A small arithmetic language for derived criteria, so "battery per gram" or "performance per
//! euro" is data, not code: `battery_mah / weight_g`, `coalesce(camera_score, main_camera_mp * 2)`.
//!
//! Numbers, attribute names, `+ - * / ^`, parentheses and the functions `min max abs sqrt ln
//! log10 clamp(x, lo, hi) coalesce(a, b, ...)`. A missing attribute makes the result missing
//! (except inside `coalesce`), and so does a division by zero.

use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FormulaError {
    #[error("unexpected {0:?} in formula")]
    Unexpected(String),
    #[error("formula ends too early")]
    Incomplete,
    #[error("unknown function {0:?}")]
    UnknownFunction(String),
    #[error("{0} takes {1} argument(s)")]
    Arity(String, &'static str),
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    Ident(String),
    Op(char),
    LParen,
    RParen,
    Comma,
}

#[derive(Debug, Clone, PartialEq)]
enum Node {
    Num(f64),
    Var(String),
    Neg(Box<Node>),
    Bin(char, Box<Node>, Box<Node>),
    Call(String, Vec<Node>),
}

/// A parsed formula; parse once, evaluate for many products.
#[derive(Debug, Clone, PartialEq)]
pub struct Formula {
    source: String,
    root: Node,
}

impl Formula {
    pub fn parse(source: &str) -> Result<Formula, FormulaError> {
        let toks = lex(source)?;
        let mut p = Parser { toks, pos: 0 };
        let root = p.expr(0)?;
        if let Some(t) = p.toks.get(p.pos) {
            return Err(FormulaError::Unexpected(describe(t)));
        }
        check_functions(&root)?;
        Ok(Formula {
            source: source.to_string(),
            root,
        })
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    /// The attribute names the formula reads.
    pub fn variables(&self) -> Vec<String> {
        fn walk(n: &Node, out: &mut Vec<String>) {
            match n {
                Node::Var(v) if !out.contains(v) => out.push(v.clone()),
                Node::Neg(a) => walk(a, out),
                Node::Bin(_, a, b) => {
                    walk(a, out);
                    walk(b, out);
                }
                Node::Call(_, args) => args.iter().for_each(|a| walk(a, out)),
                _ => {}
            }
        }
        let mut out = Vec::new();
        walk(&self.root, &mut out);
        out
    }

    /// The value, or `None` when something it needs is missing.
    pub fn eval(&self, vars: &BTreeMap<String, f64>) -> Option<f64> {
        let v = eval(&self.root, vars)?;
        v.is_finite().then_some(v)
    }
}

fn describe(t: &Tok) -> String {
    match t {
        Tok::Num(n) => n.to_string(),
        Tok::Ident(s) => s.clone(),
        Tok::Op(c) => c.to_string(),
        Tok::LParen => "(".into(),
        Tok::RParen => ")".into(),
        Tok::Comma => ",".into(),
    }
}

fn lex(src: &str) -> Result<Vec<Tok>, FormulaError> {
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < chars.len() {
        let c = chars[i];
        match c {
            c if c.is_whitespace() => i += 1,
            '0'..='9' | '.' => {
                let start = i;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    i += 1;
                }
                let text: String = chars[start..i].iter().collect();
                let n = text
                    .parse()
                    .map_err(|_| FormulaError::Unexpected(text.clone()))?;
                out.push(Tok::Num(n));
            }
            c if c.is_alphabetic() || c == '_' => {
                let start = i;
                while i < chars.len()
                    && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '.')
                {
                    i += 1;
                }
                out.push(Tok::Ident(chars[start..i].iter().collect()));
            }
            '+' | '-' | '*' | '/' | '^' => {
                out.push(Tok::Op(c));
                i += 1;
            }
            '(' => {
                out.push(Tok::LParen);
                i += 1;
            }
            ')' => {
                out.push(Tok::RParen);
                i += 1;
            }
            ',' => {
                out.push(Tok::Comma);
                i += 1;
            }
            other => return Err(FormulaError::Unexpected(other.to_string())),
        }
    }
    Ok(out)
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
}

impl Parser {
    fn next(&mut self) -> Option<Tok> {
        let t = self.toks.get(self.pos).cloned();
        self.pos += 1;
        t
    }

    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos)
    }

    fn binding(op: char) -> (u8, u8) {
        match op {
            '+' | '-' => (1, 2),
            '*' | '/' => (3, 4),
            _ => (6, 5), // '^' binds tighter than unary minus and is right associative
        }
    }

    fn expr(&mut self, min: u8) -> Result<Node, FormulaError> {
        let mut left = match self.next().ok_or(FormulaError::Incomplete)? {
            Tok::Num(n) => Node::Num(n),
            Tok::Ident(name) => {
                if self.peek() == Some(&Tok::LParen) {
                    self.pos += 1;
                    let mut args = Vec::new();
                    if self.peek() == Some(&Tok::RParen) {
                        self.pos += 1;
                    } else {
                        loop {
                            args.push(self.expr(0)?);
                            match self.next().ok_or(FormulaError::Incomplete)? {
                                Tok::Comma => continue,
                                Tok::RParen => break,
                                t => return Err(FormulaError::Unexpected(describe(&t))),
                            }
                        }
                    }
                    Node::Call(name.to_lowercase(), args)
                } else {
                    Node::Var(name)
                }
            }
            Tok::Op('-') => Node::Neg(Box::new(self.expr(5)?)),
            Tok::Op('+') => self.expr(5)?,
            Tok::LParen => {
                let inner = self.expr(0)?;
                match self.next().ok_or(FormulaError::Incomplete)? {
                    Tok::RParen => inner,
                    t => return Err(FormulaError::Unexpected(describe(&t))),
                }
            }
            t => return Err(FormulaError::Unexpected(describe(&t))),
        };
        while let Some(Tok::Op(op)) = self.peek().cloned() {
            let (l, r) = Self::binding(op);
            if l < min {
                break;
            }
            self.pos += 1;
            let right = self.expr(r)?;
            left = Node::Bin(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }
}

fn check_functions(n: &Node) -> Result<(), FormulaError> {
    match n {
        Node::Neg(a) => check_functions(a),
        Node::Bin(_, a, b) => check_functions(a).and_then(|_| check_functions(b)),
        Node::Call(name, args) => {
            let ok = match name.as_str() {
                "min" | "max" => (args.len() >= 2).then_some(()).ok_or("2 or more"),
                "coalesce" => (!args.is_empty()).then_some(()).ok_or("1 or more"),
                "abs" | "sqrt" | "ln" | "log10" => (args.len() == 1).then_some(()).ok_or("1"),
                "clamp" => (args.len() == 3).then_some(()).ok_or("3"),
                _ => return Err(FormulaError::UnknownFunction(name.clone())),
            };
            ok.map_err(|want| FormulaError::Arity(name.clone(), want))?;
            args.iter().try_for_each(check_functions)
        }
        _ => Ok(()),
    }
}

fn eval(n: &Node, vars: &BTreeMap<String, f64>) -> Option<f64> {
    Some(match n {
        Node::Num(v) => *v,
        Node::Var(name) => *vars.get(name)?,
        Node::Neg(a) => -eval(a, vars)?,
        Node::Bin(op, a, b) => {
            let (x, y) = (eval(a, vars)?, eval(b, vars)?);
            match op {
                '+' => x + y,
                '-' => x - y,
                '*' => x * y,
                '/' if y != 0.0 => x / y,
                '^' => x.powf(y),
                _ => return None,
            }
        }
        Node::Call(name, args) => {
            if name == "coalesce" {
                return args.iter().find_map(|a| eval(a, vars));
            }
            let vals: Option<Vec<f64>> = args.iter().map(|a| eval(a, vars)).collect();
            let vals = vals?;
            match name.as_str() {
                "min" => vals.iter().copied().fold(f64::INFINITY, f64::min),
                "max" => vals.iter().copied().fold(f64::NEG_INFINITY, f64::max),
                "abs" => vals[0].abs(),
                "sqrt" if vals[0] >= 0.0 => vals[0].sqrt(),
                "ln" if vals[0] > 0.0 => vals[0].ln(),
                "log10" if vals[0] > 0.0 => vals[0].log10(),
                "clamp" => vals[0].clamp(vals[1].min(vals[2]), vals[1].max(vals[2])),
                _ => return None,
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, f64)]) -> BTreeMap<String, f64> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    fn run(src: &str, v: &[(&str, f64)]) -> Option<f64> {
        Formula::parse(src).unwrap().eval(&vars(v))
    }

    #[test]
    fn arithmetic_and_precedence() {
        assert_eq!(run("1 + 2 * 3", &[]), Some(7.0));
        assert_eq!(run("(1 + 2) * 3", &[]), Some(9.0));
        assert_eq!(run("2 ^ 3 ^ 2", &[]), Some(512.0));
        assert_eq!(run("-2 ^ 2", &[]), Some(-4.0));
        assert_eq!(run("10 - 4 - 3", &[]), Some(3.0));
        assert_eq!(run("8 / 4 / 2", &[]), Some(1.0));
    }

    #[test]
    fn attributes_and_functions() {
        let v = [("battery_mah", 5000.0), ("weight_g", 200.0)];
        assert_eq!(run("battery_mah / weight_g", &v), Some(25.0));
        assert_eq!(run("max(1, battery_mah / 1000, 3)", &v), Some(5.0));
        assert_eq!(run("clamp(weight_g, 0, 150)", &v), Some(150.0));
        assert_eq!(
            run("sqrt(16) + ln(1) + log10(100) + abs(-1)", &[]),
            Some(7.0)
        );
    }

    #[test]
    fn missing_values_propagate_except_in_coalesce() {
        assert_eq!(run("a + 1", &[]), None);
        assert_eq!(run("coalesce(a, b * 2, 7)", &[("b", 4.0)]), Some(8.0));
        assert_eq!(run("coalesce(a, b)", &[]), None);
        assert_eq!(run("1 / x", &[("x", 0.0)]), None);
        assert_eq!(run("sqrt(x)", &[("x", -1.0)]), None);
    }

    #[test]
    fn reports_variables() {
        let f = Formula::parse("coalesce(camera_score, main_camera_mp * 2) / price").unwrap();
        assert_eq!(f.variables(), ["camera_score", "main_camera_mp", "price"]);
    }

    #[test]
    fn rejects_broken_formulas() {
        assert!(matches!(
            Formula::parse("1 +"),
            Err(FormulaError::Incomplete)
        ));
        assert!(matches!(
            Formula::parse("(1"),
            Err(FormulaError::Incomplete)
        ));
        assert!(matches!(
            Formula::parse("1 2"),
            Err(FormulaError::Unexpected(_))
        ));
        assert!(matches!(
            Formula::parse("foo(1)"),
            Err(FormulaError::UnknownFunction(_))
        ));
        assert!(matches!(
            Formula::parse("clamp(1, 2)"),
            Err(FormulaError::Arity(..))
        ));
        assert!(matches!(
            Formula::parse("1 $ 2"),
            Err(FormulaError::Unexpected(_))
        ));
    }
}
