//! Text folding shared by ids, search and attribute matching.

/// Lower-case, fold German umlauts and accents, drop everything but letters and digits, and
/// split at spaces, punctuation and between letters and digits (`256gb` is `256`, `gb`).
pub fn tokenize(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut cur_digit: Option<bool> = None;
    let flush = |cur: &mut String, out: &mut Vec<String>| {
        if !cur.is_empty() {
            out.push(std::mem::take(cur));
        }
    };
    for ch in text.chars().flat_map(fold) {
        if ch.is_alphanumeric() {
            let digit = ch.is_ascii_digit();
            if cur_digit.is_some_and(|d| d != digit) {
                flush(&mut cur, &mut out);
            }
            cur_digit = Some(digit);
            cur.push(ch);
        } else {
            flush(&mut cur, &mut out);
            cur_digit = None;
        }
    }
    flush(&mut cur, &mut out);
    out
}

fn fold(c: char) -> Vec<char> {
    let lower: Vec<char> = c.to_lowercase().collect();
    lower
        .into_iter()
        .flat_map(|c| match c {
            'ä' => vec!['a', 'e'],
            'ö' => vec!['o', 'e'],
            'ü' => vec!['u', 'e'],
            'ß' => vec!['s', 's'],
            'à' | 'á' | 'â' | 'ã' | 'å' => vec!['a'],
            'è' | 'é' | 'ê' | 'ë' => vec!['e'],
            'ì' | 'í' | 'î' | 'ï' => vec!['i'],
            'ò' | 'ó' | 'ô' | 'õ' => vec!['o'],
            'ù' | 'ú' | 'û' => vec!['u'],
            'ç' => vec!['c'],
            'ñ' => vec!['n'],
            other => vec![other],
        })
        .collect()
}

/// Words that name a colour or are filler in a shop title: they do not tell products apart
/// ("Pixel 9 Obsidian" and "Pixel 9 schwarz" are one product). Sizes such as `128 gb` stay, because
/// the variants differ in price and specs.
const NOISE: &[&str] = &[
    "black",
    "white",
    "blue",
    "green",
    "red",
    "pink",
    "purple",
    "gold",
    "silver",
    "gray",
    "grey",
    "yellow",
    "orange",
    "beige",
    "brown",
    "schwarz",
    "weiss",
    "blau",
    "gruen",
    "rot",
    "rosa",
    "lila",
    "grau",
    "silber",
    "gelb",
    "braun",
    "obsidian",
    "midnight",
    "starlight",
    "graphite",
    "smartphone",
    "handy",
    "mobiltelefon",
    "dual",
    "sim",
    "ohne",
    "vertrag",
    "neu",
    "new",
    "original",
    "versandkostenfrei",
    "inkl",
    "with",
    "mit",
    "und",
    "and",
    "the",
    "cell",
    "phone",
];

/// The words of a title that identify the product.
pub fn canonical_tokens(title: &str) -> Vec<String> {
    let all = tokenize(title);
    let kept: Vec<String> = all
        .iter()
        .filter(|t| !NOISE.contains(&t.as_str()))
        .cloned()
        .collect();
    if kept.is_empty() {
        all
    } else {
        kept
    }
}

/// A key for comparing names: tokens joined by a single space.
pub fn fold_key(text: &str) -> String {
    tokenize(text).join(" ")
}

/// Edit distance, giving up above `max` (returns `max + 1`).
pub fn edit_distance(a: &str, b: &str, max: usize) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.len().abs_diff(b.len()) > max {
        return max + 1;
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut cur = vec![i; b.len() + 1];
        let mut row_min = cur[0];
        for j in 1..=b.len() {
            let cost = usize::from(a[i - 1] != b[j - 1]);
            cur[j] = (prev[j] + 1).min(cur[j - 1] + 1).min(prev[j - 1] + cost);
            row_min = row_min.min(cur[j]);
        }
        if row_min > max {
            return max + 1;
        }
        prev = cur;
    }
    prev[b.len()]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_folds_and_separates_digits() {
        assert_eq!(
            tokenize("Galaxy S24 Ultra 256GB"),
            ["galaxy", "s", "24", "ultra", "256", "gb"]
        );
        assert_eq!(tokenize("Größe für Männer"), ["groesse", "fuer", "maenner"]);
        assert_eq!(tokenize("  --  "), Vec::<String>::new());
    }

    #[test]
    fn edit_distance_is_bounded() {
        assert_eq!(edit_distance("galaxy", "galxy", 2), 1);
        assert_eq!(edit_distance("galaxy", "galaxy", 2), 0);
        assert_eq!(edit_distance("pixel", "iphone", 1), 2);
        assert_eq!(edit_distance("a", "abcdef", 1), 2);
    }
}
