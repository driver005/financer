//! How a recipe reads for a number of servings: the amounts are scaled and written the way a cook
//! reads them (`1½ EL`, `250 g`, `4–6 Zehen`). All arithmetic is integer (thousandths).

/// The number at the start of `s` in thousandths, and the rest: `250`, `1,5`, `1/2`, `1 1/2`, `½`.
fn number(s: &str) -> Option<(u64, &str)> {
    fn vulgar(c: char) -> Option<u64> {
        Some(match c {
            '½' => 500,
            '¼' => 250,
            '¾' => 750,
            '⅓' => 333,
            '⅔' => 667,
            _ => return None,
        })
    }
    fn digits(s: &str) -> (&str, &str) {
        let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
        s.split_at(end)
    }
    fn int(d: &str) -> Option<u64> {
        (!d.is_empty() && d.len() <= 9)
            .then(|| d.parse().ok())
            .flatten()
    }
    fn fraction(s: &str) -> Option<(u64, &str)> {
        if let Some(c) = s.chars().next() {
            if let Some(v) = vulgar(c) {
                return Some((v, &s[c.len_utf8()..]));
            }
        }
        let (num, rest) = digits(s);
        let (den, rest) = digits(rest.strip_prefix('/')?);
        let (num, den) = (int(num)?, int(den)?);
        (den > 0).then(|| (num * 1000 / den, rest))
    }
    if let Some(f) = fraction(s) {
        return Some(f);
    }
    let (whole_text, rest) = digits(s);
    let whole = int(whole_text)?;
    if let Some(after) = rest.strip_prefix([',', '.']) {
        let (frac, rest) = digits(after);
        if !frac.is_empty() {
            let kept: String = frac.chars().take(3).collect();
            return Some((whole * 1000 + int(&format!("{kept:0<3}"))?, rest));
        }
    }
    if rest.starts_with(' ') {
        if let Some((frac, after)) = fraction(rest.trim_start()) {
            return Some((whole * 1000 + frac, after));
        }
    }
    Some((whole * 1000, rest))
}

/// `thousandths` as a cook reads it: `1½`, `¼`, `2,5`, `250`.
fn write(thousandths: u64) -> String {
    let whole = thousandths / 1000;
    let frac = thousandths % 1000;
    let with = |w: u64, glyph: &str| match (w, glyph) {
        (w, "") => w.to_string(),
        (0, g) => g.to_string(),
        (w, g) => format!("{w}{g}"),
    };
    if frac <= 40 {
        return with(whole, "");
    }
    if frac >= 960 {
        return with(whole + 1, "");
    }
    for (target, glyph) in [(250, "¼"), (333, "⅓"), (500, "½"), (667, "⅔"), (750, "¾")] {
        if frac.abs_diff(target) <= 40 {
            return with(whole, glyph);
        }
    }
    let tenths = (thousandths + 50) / 100;
    if tenths.is_multiple_of(10) {
        (tenths / 10).to_string()
    } else {
        format!("{},{}", tenths / 10, tenths % 10)
    }
}

fn scale(thousandths: u64, servings: u32, base: u32) -> u64 {
    let base = u64::from(base.max(1));
    ((thousandths * u64::from(servings.max(1)) * 2 + base) / (2 * base)).max(1)
}

/// An amount text for `servings` instead of `base`: the leading number (both ends of a range) is
/// scaled; text without a number ("nach Geschmack") stays as it is.
pub fn scale_amount(text: &str, servings: u32, base: u32) -> String {
    let Some((first, rest)) = number(text.trim_start()) else {
        return text.to_string();
    };
    let mut out = write(scale(first, servings, base));
    let mut tail = rest;
    if let Some(upper) = rest.trim_start().strip_prefix(['-', '–']) {
        if let Some((second, after)) = number(upper.trim_start()) {
            out.push('–');
            out.push_str(&write(scale(second, servings, base)));
            tail = after;
        }
    }
    out.push_str(tail);
    out
}

/// The servings a person can pick for a recipe made for `base`: at least one, at most 24.
pub fn clamp_servings(n: i64) -> u32 {
    n.clamp(1, 24) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amounts_scale_and_read_like_a_recipe() {
        assert_eq!(scale_amount("250 g", 4, 2), "500 g");
        assert_eq!(scale_amount("1 EL", 1, 2), "½ EL");
        assert_eq!(scale_amount("1/2 Dose", 4, 2), "1 Dose");
        assert_eq!(scale_amount("2 Eier", 3, 4), "1½ Eier");
        assert_eq!(scale_amount("2-3 Zehen", 8, 4), "4–6 Zehen");
        assert_eq!(scale_amount("1,5 l", 2, 4), "¾ l");
        assert_eq!(scale_amount("200 g", 3, 2), "300 g");
        assert_eq!(scale_amount("nach Geschmack", 8, 2), "nach Geschmack");
        assert_eq!(scale_amount("1 Prise", 1, 4), "¼ Prise");
    }

    #[test]
    fn servings_stay_between_one_and_twenty_four() {
        assert_eq!(clamp_servings(0), 1);
        assert_eq!(clamp_servings(7), 7);
        assert_eq!(clamp_servings(99), 24);
    }
}
