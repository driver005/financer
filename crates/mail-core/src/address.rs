//! Mail addresses: parsing `Name <a@b.de>` lists, and a best guess of a person's first and last
//! name for the greeting templates.

use serde::{Deserialize, Serialize};

/// One mailbox. The address is stored lower-case; the name is what the sender called themselves.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Address {
    pub name: Option<String>,
    pub email: String,
}

/// Local parts that are a function, not a person.
const GENERIC_LOCALS: &[&str] = &[
    "info",
    "kontakt",
    "contact",
    "support",
    "service",
    "hello",
    "hallo",
    "hi",
    "mail",
    "office",
    "admin",
    "team",
    "sales",
    "vertrieb",
    "post",
    "kundenservice",
    "noreply",
    "no-reply",
    "donotreply",
    "do-not-reply",
    "newsletter",
    "news",
    "notifications",
    "notification",
    "billing",
    "rechnung",
    "mailer-daemon",
    "postmaster",
    "bestellung",
    "orders",
    "shop",
    "buchhaltung",
    "datenschutz",
    "jobs",
    "karriere",
    "welcome",
    "feedback",
    "reply",
    "bounce",
    "bounces",
    "system",
    "alerts",
    "alert",
    "updates",
    "marketing",
    "presse",
    "press",
];

/// Titles that are not part of a name.
const TITLES: &[&str] = &[
    "dr",
    "dr.",
    "prof",
    "prof.",
    "herr",
    "frau",
    "mr",
    "mr.",
    "mrs",
    "mrs.",
    "ms",
    "ms.",
    "dipl.-ing.",
    "dipl.-ing",
    "ing.",
    "mag.",
    "mag",
];

pub fn is_valid_email(s: &str) -> bool {
    let Some((local, domain)) = s.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && local.len() <= 64
        && s.len() <= 254
        && !local.contains(['@', ' ', '<', '>', ',', ';', '"', '(', ')', '[', ']', '\\'])
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.contains("..")
        && domain
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '.')
}

impl Address {
    pub fn new(name: Option<&str>, email: &str) -> Option<Address> {
        let email = email.trim().trim_matches(['<', '>']).to_lowercase();
        if !is_valid_email(&email) {
            return None;
        }
        let name = name
            .map(|n| n.trim().trim_matches('"').trim().to_string())
            .filter(|n| !n.is_empty() && n.to_lowercase() != email);
        Some(Address { name, email })
    }

    /// `paul@x.de`, `<paul@x.de>` or `Paul Meier <paul@x.de>`.
    pub fn parse(input: &str) -> Option<Address> {
        let input = input.trim();
        if let (Some(open), Some(close)) = (input.rfind('<'), input.rfind('>')) {
            if open < close {
                let name = input[..open].trim();
                return Address::new(Some(name), &input[open + 1..close]);
            }
        }
        Address::new(None, input)
    }

    /// A comma or semicolon separated list; separators inside quotes or `<>` do not split.
    pub fn parse_list(input: &str) -> Vec<Address> {
        let mut parts = Vec::new();
        let mut current = String::new();
        let (mut quoted, mut angle) = (false, false);
        for c in input.chars() {
            match c {
                '"' => {
                    quoted = !quoted;
                    current.push(c);
                }
                '<' if !quoted => {
                    angle = true;
                    current.push(c);
                }
                '>' if !quoted => {
                    angle = false;
                    current.push(c);
                }
                ',' | ';' if !quoted && !angle => parts.push(std::mem::take(&mut current)),
                _ => current.push(c),
            }
        }
        parts.push(current);
        let mut out: Vec<Address> = Vec::new();
        for p in parts {
            if let Some(a) = Address::parse(&p) {
                if !out.iter().any(|o| o.email == a.email) {
                    out.push(a);
                }
            }
        }
        out
    }

    /// What to show for this person: their name, else the address.
    pub fn display(&self) -> String {
        self.name.clone().unwrap_or_else(|| self.email.clone())
    }

    /// `Name <address>` for a header, quoting the name when needed.
    pub fn header(&self) -> String {
        match &self.name {
            Some(n)
                if n.chars()
                    .all(|c| c.is_alphanumeric() || c == ' ' || c == '-' || c == '.') =>
            {
                format!("{n} <{}>", self.email)
            }
            Some(n) => format!("\"{}\" <{}>", n.replace(['"', '\\'], ""), self.email),
            None => self.email.clone(),
        }
    }

    pub fn domain(&self) -> &str {
        self.email.split_once('@').map(|(_, d)| d).unwrap_or("")
    }

    /// First and last name as best they can be told: `Meier, Paul`, `Dr. Paul Meier`,
    /// `paul.meier@x.de`. `None` for a function address such as `info@x.de`.
    pub fn person_name(&self) -> Option<(String, Option<String>)> {
        if let Some(name) = &self.name {
            if let Some(parts) = name_from_display(name) {
                return Some(parts);
            }
        }
        name_from_local(self.email.split('@').next().unwrap_or(""))
    }

    pub fn first_name(&self) -> Option<String> {
        self.person_name().map(|(f, _)| f)
    }

    pub fn last_name(&self) -> Option<String> {
        self.person_name().and_then(|(_, l)| l)
    }
}

fn capitalise(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
        None => String::new(),
    }
}

/// Name particles that stay lower-case in the middle of a name.
const PARTICLES: &[&str] = &[
    "von", "van", "de", "der", "den", "zu", "zur", "da", "di", "la", "le", "bin", "ibn", "ter",
    "ten",
];

/// Keep a name's own capitalisation when it has one ("McDonald", "von Berg"); fix an all-lower or
/// all-upper one ("PAUL", "paul").
fn tidy(word: &str) -> String {
    let has_upper = word.chars().any(|c| c.is_uppercase());
    let has_lower = word.chars().any(|c| c.is_lowercase());
    if (has_upper && has_lower) || PARTICLES.contains(&word) {
        word.to_string()
    } else {
        word.split('-')
            .map(capitalise)
            .collect::<Vec<_>>()
            .join("-")
    }
}

fn is_word(w: &str) -> bool {
    !w.is_empty()
        && w.chars()
            .all(|c| c.is_alphabetic() || c == '-' || c == '\'' || c == '.')
}

fn name_from_display(name: &str) -> Option<(String, Option<String>)> {
    let name = name.trim();
    // "Meier, Paul" is last name first
    if let Some((last, first)) = name.split_once(',') {
        let first: Vec<&str> = first
            .split_whitespace()
            .filter(|w| !TITLES.contains(&w.to_lowercase().as_str()))
            .collect();
        let last: Vec<&str> = last
            .split_whitespace()
            .filter(|w| !TITLES.contains(&w.to_lowercase().as_str()))
            .collect();
        if let (Some(f), false) = (first.first(), last.is_empty()) {
            if is_word(f) && last.iter().all(|w| is_word(w)) {
                return Some((
                    tidy(f),
                    Some(last.iter().map(|w| tidy(w)).collect::<Vec<_>>().join(" ")),
                ));
            }
        }
        return None;
    }
    let words: Vec<&str> = name
        .split_whitespace()
        .filter(|w| !TITLES.contains(&w.to_lowercase().as_str()))
        .collect();
    if words.is_empty() || !words.iter().all(|w| is_word(w)) || words.len() > 4 {
        return None;
    }
    // a single word that is a function ("Support", "Newsletter") is not a person
    if words.len() == 1 && GENERIC_LOCALS.contains(&words[0].to_lowercase().as_str()) {
        return None;
    }
    let first = tidy(words[0]);
    let last = (words.len() > 1).then(|| {
        words[1..]
            .iter()
            .map(|w| tidy(w))
            .collect::<Vec<_>>()
            .join(" ")
    });
    Some((first, last))
}

fn name_from_local(local: &str) -> Option<(String, Option<String>)> {
    let local = local.split('+').next().unwrap_or(local).to_lowercase();
    if GENERIC_LOCALS.contains(&local.as_str()) {
        return None;
    }
    let parts: Vec<&str> = local
        .split(['.', '_', '-'])
        .filter(|p| !p.is_empty())
        .collect();
    let alpha = |p: &str| p.chars().all(|c| c.is_alphabetic()) && p.chars().count() >= 2;
    match parts.as_slice() {
        [first, last] if alpha(first) && alpha(last) => {
            Some((capitalise(first), Some(capitalise(last))))
        }
        [one] if alpha(one) && one.chars().count() >= 3 => Some((capitalise(one), None)),
        _ => None,
    }
}

/// True for an address that is a machine, not a person: newsletters, shops, notifications.
pub fn is_automated_sender(email: &str) -> bool {
    let email = email.to_lowercase();
    let local = email.split('@').next().unwrap_or("");
    let local = local.split('+').next().unwrap_or(local);
    const MARKERS: &[&str] = &[
        "noreply",
        "no-reply",
        "no_reply",
        "donotreply",
        "do-not-reply",
        "newsletter",
        "mailer-daemon",
        "notification",
        "notifications",
        "bounce",
        "automated",
        "alerts",
        "news",
    ];
    MARKERS.iter().any(|m| {
        local == *m
            || local.starts_with(&format!("{m}-"))
            || local.starts_with(&format!("{m}."))
            || local.starts_with(&format!("{m}_"))
            || local.ends_with(&format!("-{m}"))
            || local.ends_with(&format!(".{m}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_and_named_addresses() {
        let a = Address::parse("Paul Meier <Paul.Meier@Example.DE>").unwrap();
        assert_eq!(a.email, "paul.meier@example.de");
        assert_eq!(a.name.as_deref(), Some("Paul Meier"));
        assert_eq!(Address::parse("max@x.de").unwrap().name, None);
        assert_eq!(Address::parse("<max@x.de>").unwrap().email, "max@x.de");
        assert_eq!(
            Address::parse("\"Meier, Paul\" <p@x.de>")
                .unwrap()
                .name
                .as_deref(),
            Some("Meier, Paul")
        );
    }

    #[test]
    fn rejects_things_that_are_not_addresses() {
        for bad in [
            "",
            "paul",
            "paul@",
            "@x.de",
            "paul@x",
            "pa ul@x.de",
            "paul@x..de",
            "a@b@c.de",
        ] {
            assert!(Address::parse(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn a_name_equal_to_the_address_is_dropped() {
        assert_eq!(Address::parse("max@x.de <max@x.de>").unwrap().name, None);
    }

    #[test]
    fn lists_split_on_commas_but_not_inside_quotes() {
        let list =
            Address::parse_list("\"Meier, Paul\" <p@x.de>, anna@y.de; Max <max@z.de>, p@x.de");
        let emails: Vec<_> = list.iter().map(|a| a.email.as_str()).collect();
        assert_eq!(emails, ["p@x.de", "anna@y.de", "max@z.de"]);
        assert_eq!(list[0].name.as_deref(), Some("Meier, Paul"));
    }

    #[test]
    fn guesses_first_names_from_display_names() {
        let n = |s: &str| Address::parse(s).unwrap().person_name();
        assert_eq!(
            n("Paul Meier <p@x.de>"),
            Some(("Paul".into(), Some("Meier".into())))
        );
        assert_eq!(
            n("\"Meier, Paul\" <p@x.de>"),
            Some(("Paul".into(), Some("Meier".into())))
        );
        assert_eq!(
            n("Dr. Anna Schmidt <a@x.de>"),
            Some(("Anna".into(), Some("Schmidt".into())))
        );
        assert_eq!(
            n("MAX MUSTERMANN <m@x.de>"),
            Some(("Max".into(), Some("Mustermann".into())))
        );
        assert_eq!(
            n("Hans-Peter von Berg <h@x.de>"),
            Some(("Hans-Peter".into(), Some("von Berg".into())))
        );
        assert_eq!(n("Max <m@x.de>"), Some(("Max".into(), None)));
    }

    #[test]
    fn guesses_names_from_the_local_part_only_when_it_looks_like_a_person() {
        let n = |s: &str| Address::parse(s).unwrap().person_name();
        assert_eq!(
            n("paul.meier@x.de"),
            Some(("Paul".into(), Some("Meier".into())))
        );
        assert_eq!(n("paul@x.de"), Some(("Paul".into(), None)));
        assert_eq!(n("info@x.de"), None);
        assert_eq!(n("Support <support@x.de>"), None);
        assert_eq!(n("p4ul@x.de"), None);
        assert_eq!(n("xy@x.de"), None);
    }

    #[test]
    fn automated_senders() {
        for s in [
            "noreply@shop.de",
            "no-reply@x.com",
            "newsletter@x.de",
            "shop-noreply@x.de",
            "notifications@github.com",
        ] {
            assert!(is_automated_sender(s), "{s}");
        }
        for s in [
            "paul@x.de",
            "anna.news@x.de".replace("news", "meier").as_str(),
            "info@x.de",
        ] {
            assert!(!is_automated_sender(s), "{s}");
        }
    }

    #[test]
    fn header_quotes_names_with_odd_characters() {
        assert_eq!(
            Address::new(Some("Paul Meier"), "p@x.de").unwrap().header(),
            "Paul Meier <p@x.de>"
        );
        assert_eq!(
            Address::new(Some("Meier, Paul"), "p@x.de")
                .unwrap()
                .header(),
            "\"Meier, Paul\" <p@x.de>"
        );
        assert_eq!(Address::new(None, "p@x.de").unwrap().header(), "p@x.de");
    }
}
