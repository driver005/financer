//! Just enough HTML: spec tables, links and the visible text of a page.

use std::sync::OnceLock;

use financer_prices::pagetext::PageText;
use regex::Regex;
use url::Url;

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

/// Visible text of a fragment on one line.
pub fn cell_text(fragment: &str) -> String {
    PageText::html_to_text(fragment)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// `label: value` pairs from two-column table rows and from `<dt>/<dd>` pairs.
pub fn spec_pairs(html: &str) -> Vec<(String, String)> {
    static ROW: OnceLock<Regex> = OnceLock::new();
    static CELL: OnceLock<Regex> = OnceLock::new();
    static DL: OnceLock<Regex> = OnceLock::new();
    let mut out: Vec<(String, String)> = Vec::new();
    let mut push = |label: String, value: String| {
        let ok = !label.is_empty()
            && !value.is_empty()
            && label.chars().count() <= 60
            && value.chars().count() <= 200
            && !out.iter().any(|(l, _)| *l == label);
        if ok {
            out.push((label, value));
        }
    };
    for row in re(&ROW, r"(?is)<tr\b[^>]*>(.*?)</tr>").captures_iter(html) {
        let cells: Vec<String> = re(&CELL, r"(?is)<t[hd]\b[^>]*>(.*?)</t[hd]>")
            .captures_iter(&row[1])
            .map(|c| cell_text(&c[1]))
            .collect();
        if let [label, value] = cells.as_slice() {
            push(
                label.trim_end_matches(':').trim().to_string(),
                value.clone(),
            );
        }
    }
    for pair in re(&DL, r"(?is)<dt\b[^>]*>(.*?)</dt>\s*<dd\b[^>]*>(.*?)</dd>").captures_iter(html) {
        push(
            cell_text(&pair[1]).trim_end_matches(':').trim().to_string(),
            cell_text(&pair[2]),
        );
    }
    out
}

/// Absolute links of a page, without fragments, in page order.
pub fn links(html: &str, base: &Url) -> Vec<Url> {
    static A: OnceLock<Regex> = OnceLock::new();
    let mut out: Vec<Url> = Vec::new();
    for c in re(&A, r#"(?is)<a\s[^>]*?href\s*=\s*["']([^"']+)["']"#).captures_iter(html) {
        let href = c[1].trim().replace("&amp;", "&");
        if href.starts_with("javascript:") || href.starts_with("mailto:") || href.starts_with('#') {
            continue;
        }
        if let Ok(mut u) = base.join(&href) {
            u.set_fragment(None);
            if matches!(u.scheme(), "http" | "https") && !out.contains(&u) {
                out.push(u);
            }
        }
    }
    out
}

/// `<loc>` addresses of a sitemap (sitemap index files list further sitemaps the same way).
pub fn sitemap_locs(xml: &str) -> Vec<String> {
    static LOC: OnceLock<Regex> = OnceLock::new();
    re(
        &LOC,
        r"(?is)<loc>\s*(?:<!\[CDATA\[)?\s*(.*?)\s*(?:\]\]>)?\s*</loc>",
    )
    .captures_iter(xml)
    .map(|c| c[1].replace("&amp;", "&"))
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_tables_and_definition_lists() {
        let html = r#"
          <table><tr><th>Akkukapazität:</th><td>5.000&nbsp;mAh</td></tr>
          <tr><td>Display</td><td><span>6,7 Zoll</span></td></tr>
          <tr><td>only one cell</td></tr>
          <tr><th>Gewicht</th><td>199 g</td></tr></table>
          <dl><dt>NFC</dt><dd>Ja</dd><dt>Gewicht</dt><dd>duplicate</dd></dl>"#;
        let pairs = spec_pairs(html);
        assert_eq!(
            pairs,
            [
                ("Akkukapazität".to_string(), "5.000 mAh".to_string()),
                ("Display".to_string(), "6,7 Zoll".to_string()),
                ("Gewicht".to_string(), "199 g".to_string()),
                ("NFC".to_string(), "Ja".to_string()),
            ]
        );
    }

    #[test]
    fn resolves_links_and_drops_noise() {
        let base = Url::parse("https://shop.test/c/phones/").unwrap();
        let html = r##"<a href="/p/1?a=1&amp;b=2#x">1</a> <a href='2'>2</a> <a href="#top">t</a>
            <a href="mailto:x@y.z">m</a> <a href="/p/1?a=1&b=2">dup</a> <a href="https://other.test/p/9">o</a>"##;
        let l: Vec<String> = links(html, &base).iter().map(Url::to_string).collect();
        assert_eq!(
            l,
            [
                "https://shop.test/p/1?a=1&b=2",
                "https://shop.test/c/phones/2",
                "https://other.test/p/9"
            ]
        );
    }

    #[test]
    fn reads_sitemap_locations() {
        let xml = "<urlset><url><loc>https://s.test/p/1</loc></url><url><loc> https://s.test/p/2?a=1&amp;b=2 </loc></url></urlset>";
        assert_eq!(
            sitemap_locs(xml),
            ["https://s.test/p/1", "https://s.test/p/2?a=1&b=2"]
        );
    }
}
