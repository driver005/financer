//! Conversations. A mailbox is a flat list of messages; this turns it into the two views of a chat
//! app: **people** (everything exchanged with one person, or one group of people, as one chat) and
//! **topics** (one thread about one subject, whoever takes part).
//!
//! Both are computed from the messages every time, never stored, so a message that arrives out of
//! order (a reply before the original) cannot leave a thread split in two.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::address::Address;
use crate::subject::{normalize_subject, topic_key};

/// Messages of one topic that are further apart than this are two topics, when only the subject
/// (and not the mail headers) says they belong together.
const SAME_SUBJECT_WINDOW_SECS: i64 = 60 * 24 * 3600;

/// Everything about a message that grouping needs (the body is not part of it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Meta {
    pub id: i64,
    pub message_id: String,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub subject: String,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    /// Seconds since the epoch.
    pub date: i64,
    /// Sent by you.
    pub outgoing: bool,
    pub seen: bool,
    /// A newsletter, a notification, a mailing list: not a person writing to you.
    pub automated: bool,
    pub snippet: String,
}

/// Your own addresses.
#[derive(Debug, Clone, Default)]
pub struct Me {
    emails: HashSet<String>,
}

impl Me {
    pub fn new<I: IntoIterator<Item = S>, S: AsRef<str>>(emails: I) -> Me {
        Me {
            emails: emails
                .into_iter()
                .map(|e| e.as_ref().trim().to_lowercase())
                .collect(),
        }
    }
    pub fn is_me(&self, a: &Address) -> bool {
        self.emails.contains(&a.email)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversationKind {
    Person,
    Topic,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Conversation {
    /// Stable id, usable in a URL: `p-...` for a person's chat, `t-...` for a topic.
    pub key: String,
    pub kind: ConversationKind,
    /// A person's name (several: "Anna, Max & Tom"), or the topic's subject.
    pub title: String,
    /// The people other than you.
    pub people: Vec<Address>,
    pub count: usize,
    pub unread: usize,
    pub last_at: i64,
    pub last_from_me: bool,
    pub preview: String,
    /// The latest topics talked about (for a person), at most three.
    pub topics: Vec<String>,
    /// Every message is automated (a newsletter, a shop): kept apart from the people.
    pub automated: bool,
}

/// The conversations, newest first, and which messages (by id, oldest first) are in each.
#[derive(Debug, Clone, Default)]
pub struct Grouping {
    pub conversations: Vec<Conversation>,
    pub members: HashMap<String, Vec<i64>>,
}

fn key_of(prefix: &str, seed: &str) -> String {
    let digest = Sha256::digest(seed.as_bytes());
    let hex: String = digest.iter().take(6).map(|b| format!("{b:02x}")).collect();
    format!("{prefix}-{hex}")
}

/// The other people in a message: the sender when it is not you, plus whoever else is on it.
fn others(m: &Meta, me: &Me) -> Vec<Address> {
    let mut out: Vec<Address> = Vec::new();
    let mut push = |a: &Address| {
        if !me.is_me(a) && !out.iter().any(|o| o.email == a.email) {
            out.push(a.clone());
        }
    };
    push(&m.from);
    m.to.iter().for_each(&mut push);
    m.cc.iter().for_each(&mut push);
    if out.is_empty() {
        // a note to yourself
        out.push(m.from.clone());
    }
    out.sort_by(|a, b| a.email.cmp(&b.email));
    out
}

/// The name a person goes by: the most often used name in mail *from* them, else any seen.
fn best_names(metas: &[&Meta], me: &Me) -> HashMap<String, Address> {
    let mut counts: HashMap<String, HashMap<String, usize>> = HashMap::new();
    let mut any: HashMap<String, Address> = HashMap::new();
    for m in metas {
        for a in std::iter::once(&m.from)
            .chain(m.to.iter())
            .chain(m.cc.iter())
        {
            if me.is_me(a) {
                continue;
            }
            any.entry(a.email.clone()).or_insert_with(|| a.clone());
            if let Some(n) = &a.name {
                let weight = if a.email == m.from.email { 2 } else { 1 };
                *counts
                    .entry(a.email.clone())
                    .or_default()
                    .entry(n.clone())
                    .or_default() += weight;
            }
        }
    }
    let mut out = HashMap::new();
    for (email, fallback) in any {
        let name = counts
            .get(&email)
            .and_then(|names| names.iter().max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0))))
            .map(|(n, _)| n.clone());
        out.insert(
            email.clone(),
            Address {
                name: name.or(fallback.name),
                email,
            },
        );
    }
    out
}

fn title_for(people: &[Address]) -> String {
    let names: Vec<String> = people.iter().map(|p| p.display()).collect();
    match names.len() {
        0 => String::new(),
        1 => names[0].clone(),
        _ => {
            let (last, rest) = names.split_last().expect("not empty");
            format!("{} & {}", rest.join(", "), last)
        }
    }
}

fn summarise(
    key: String,
    kind: ConversationKind,
    title: String,
    people: Vec<Address>,
    mut members: Vec<&Meta>,
) -> (Conversation, Vec<i64>) {
    members.sort_by_key(|m| (m.date, m.id));
    let last = members.last().expect("a conversation has a message");
    let mut topics: Vec<String> = Vec::new();
    for m in members.iter().rev() {
        let t = normalize_subject(&m.subject);
        if !t.is_empty() && !topics.iter().any(|x| x.to_lowercase() == t.to_lowercase()) {
            topics.push(t);
            if topics.len() == 3 {
                break;
            }
        }
    }
    let conversation = Conversation {
        key,
        kind,
        title,
        people,
        count: members.len(),
        unread: members.iter().filter(|m| !m.seen && !m.outgoing).count(),
        last_at: last.date,
        last_from_me: last.outgoing,
        preview: last.snippet.clone(),
        topics: if kind == ConversationKind::Person {
            topics
        } else {
            Vec::new()
        },
        automated: members.iter().all(|m| m.automated),
    };
    let ids = members.iter().map(|m| m.id).collect();
    (conversation, ids)
}

/// One chat per person (or per group of people), automated senders kept apart from the rest.
pub fn group_by_person(metas: &[Meta], me: &Me) -> Grouping {
    let refs: Vec<&Meta> = metas.iter().collect();
    let names = best_names(&refs, me);
    let mut buckets: BTreeMap<String, (Vec<Address>, Vec<&Meta>)> = BTreeMap::new();
    for m in metas {
        let people = others(m, me);
        let seed = people
            .iter()
            .map(|p| p.email.as_str())
            .collect::<Vec<_>>()
            .join(",");
        buckets
            .entry(seed)
            .or_insert_with(|| (people, Vec::new()))
            .1
            .push(m);
    }
    let mut grouping = Grouping::default();
    for (seed, (people, members)) in buckets {
        let people: Vec<Address> = people
            .iter()
            .map(|p| names.get(&p.email).cloned().unwrap_or_else(|| p.clone()))
            .collect();
        let key = key_of("p", &seed);
        let (c, ids) = summarise(
            key.clone(),
            ConversationKind::Person,
            title_for(&people),
            people,
            members,
        );
        grouping.members.insert(key, ids);
        grouping.conversations.push(c);
    }
    sort_newest_first(&mut grouping.conversations);
    grouping
}

struct Union(Vec<usize>);

impl Union {
    fn find(&mut self, i: usize) -> usize {
        let mut root = i;
        while self.0[root] != root {
            root = self.0[root];
        }
        let mut cur = i;
        while self.0[cur] != root {
            let next = self.0[cur];
            self.0[cur] = root;
            cur = next;
        }
        root
    }
    fn join(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.0[rb.max(ra)] = ra.min(rb);
        }
    }
}

/// One conversation per thread: messages joined through `In-Reply-To` and `References`, and
/// otherwise through the same subject with a person in common (within two months).
pub fn group_by_topic(metas: &[Meta], me: &Me) -> Grouping {
    let mut union = Union((0..metas.len()).collect());
    let by_id: HashMap<&str, usize> = metas
        .iter()
        .enumerate()
        .map(|(i, m)| (m.message_id.as_str(), i))
        .collect();
    let mut linked = vec![false; metas.len()];
    for (i, m) in metas.iter().enumerate() {
        for r in m.in_reply_to.iter().chain(m.references.iter()) {
            if let Some(&j) = by_id.get(r.as_str()) {
                if j != i {
                    union.join(i, j);
                    linked[i] = true;
                    linked[j] = true;
                }
            }
        }
    }
    // the subject, for mail whose headers do not connect it (some clients drop References)
    let mut order: Vec<usize> = (0..metas.len()).collect();
    order.sort_by_key(|&i| (metas[i].date, metas[i].id));
    let mut recent: HashMap<(String, String), (usize, i64)> = HashMap::new();
    for &i in &order {
        let m = &metas[i];
        let topic = topic_key(&m.subject);
        if topic.is_empty() {
            continue;
        }
        let is_reply = normalize_subject(&m.subject)
            != m.subject.split_whitespace().collect::<Vec<_>>().join(" ");
        for p in others(m, me) {
            let slot = (topic.clone(), p.email.clone());
            if let Some(&(j, at)) = recent.get(&slot) {
                // an unlinked message joins the earlier one with the same subject; a reply may also
                // join a thread that is already linked (its References were lost on the way)
                if (!linked[i] || is_reply)
                    && m.date - at <= SAME_SUBJECT_WINDOW_SECS
                    && !m.automated
                {
                    union.join(i, j);
                }
            }
            recent.insert(slot, (i, m.date));
        }
    }
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for i in 0..metas.len() {
        let root = union.find(i);
        groups.entry(root).or_default().push(i);
    }
    let refs: Vec<&Meta> = metas.iter().collect();
    let names = best_names(&refs, me);
    let mut grouping = Grouping::default();
    for (_, idx) in groups {
        let mut members: Vec<&Meta> = idx.iter().map(|&i| &metas[i]).collect();
        members.sort_by_key(|m| (m.date, m.id));
        let first = members[0];
        let mut people: Vec<Address> = Vec::new();
        for m in &members {
            for p in others(m, me) {
                if !people.iter().any(|x| x.email == p.email) {
                    people.push(names.get(&p.email).cloned().unwrap_or(p));
                }
            }
        }
        let title = {
            let t = normalize_subject(&first.subject);
            if t.is_empty() {
                "(no subject)".to_string()
            } else {
                t
            }
        };
        let key = key_of("t", &first.message_id);
        let (c, ids) = summarise(key.clone(), ConversationKind::Topic, title, people, members);
        grouping.members.insert(key, ids);
        grouping.conversations.push(c);
    }
    sort_newest_first(&mut grouping.conversations);
    grouping
}

fn sort_newest_first(list: &mut [Conversation]) {
    list.sort_by(|a, b| b.last_at.cmp(&a.last_at).then(a.key.cmp(&b.key)));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(s: &str) -> Address {
        Address::parse(s).unwrap()
    }

    struct B(Meta);
    impl B {
        fn new(id: i64, subject: &str, from: &str, to: &[&str], date: i64) -> B {
            B(Meta {
                id,
                message_id: format!("m{id}@x"),
                in_reply_to: None,
                references: vec![],
                subject: subject.into(),
                from: addr(from),
                to: to.iter().map(|t| addr(t)).collect(),
                cc: vec![],
                date,
                outgoing: from.contains("paul@x.de"),
                seen: true,
                automated: false,
                snippet: format!("snippet {id}"),
            })
        }
        fn reply_to(mut self, id: i64) -> B {
            self.0.in_reply_to = Some(format!("m{id}@x"));
            self
        }
        fn unseen(mut self) -> B {
            self.0.seen = false;
            self
        }
        fn automated(mut self) -> B {
            self.0.automated = true;
            self
        }
        fn get(self) -> Meta {
            self.0
        }
    }

    fn me() -> Me {
        Me::new(["paul@x.de"])
    }
    const DAY: i64 = 86_400;

    #[test]
    fn one_chat_per_person_across_topics_and_directions() {
        let metas = vec![
            B::new(
                1,
                "Wohnung",
                "Max Muster <max@y.de>",
                &["Paul <paul@x.de>"],
                100,
            )
            .get(),
            B::new(2, "Re: Wohnung", "Paul <paul@x.de>", &["max@y.de"], 200).get(),
            B::new(3, "Fußball am Samstag", "max@y.de", &["paul@x.de"], 300)
                .unseen()
                .get(),
            B::new(4, "Rechnung", "Anna <anna@z.de>", &["paul@x.de"], 250).get(),
        ];
        let g = group_by_person(&metas, &me());
        assert_eq!(g.conversations.len(), 2);
        let max = &g.conversations[0];
        assert_eq!(max.title, "Max Muster");
        assert_eq!(max.count, 3);
        assert_eq!(max.unread, 1);
        assert_eq!(max.last_at, 300);
        assert_eq!(max.topics, ["Fußball am Samstag", "Wohnung"]);
        assert_eq!(g.members[&max.key], [1, 2, 3]);
        assert_eq!(g.conversations[1].title, "Anna");
    }

    #[test]
    fn a_chat_with_several_people_is_its_own_chat() {
        let mut to_both = B::new(1, "Plan", "paul@x.de", &["max@y.de", "anna@z.de"], 100).get();
        to_both.outgoing = true;
        let metas = vec![
            to_both,
            B::new(2, "Hi", "max@y.de", &["paul@x.de"], 200).get(),
        ];
        let g = group_by_person(&metas, &me());
        assert_eq!(g.conversations.len(), 2);
        assert!(g
            .conversations
            .iter()
            .any(|c| c.people.len() == 2 && c.title.contains(" & ")));
    }

    #[test]
    fn the_key_is_the_same_whatever_arrives_later() {
        let a = vec![B::new(1, "x", "max@y.de", &["paul@x.de"], 100).get()];
        let b = vec![
            B::new(1, "x", "max@y.de", &["paul@x.de"], 100).get(),
            B::new(2, "y", "max@y.de", &["paul@x.de"], 500).get(),
        ];
        assert_eq!(
            group_by_person(&a, &me()).conversations[0].key,
            group_by_person(&b, &me()).conversations[0].key
        );
    }

    #[test]
    fn the_name_comes_from_mail_the_person_wrote_themselves() {
        let metas = vec![
            B::new(1, "a", "paul@x.de", &["max@y.de"], 100).get(),
            B::new(2, "b", "Maximilian Muster <max@y.de>", &["paul@x.de"], 200).get(),
        ];
        assert_eq!(
            group_by_person(&metas, &me()).conversations[0].title,
            "Maximilian Muster"
        );
    }

    #[test]
    fn a_note_to_yourself_is_a_chat_with_yourself() {
        let metas = vec![B::new(1, "Einkauf", "paul@x.de", &["paul@x.de"], 100).get()];
        let g = group_by_person(&metas, &me());
        assert_eq!(g.conversations.len(), 1);
        assert_eq!(g.conversations[0].people[0].email, "paul@x.de");
    }

    #[test]
    fn automated_chats_are_marked() {
        let metas = vec![
            B::new(1, "Angebote", "Shop <news@shop.de>", &["paul@x.de"], 100)
                .automated()
                .get(),
            B::new(2, "Hi", "max@y.de", &["paul@x.de"], 200).get(),
        ];
        let g = group_by_person(&metas, &me());
        assert_eq!(g.conversations.iter().filter(|c| c.automated).count(), 1);
        assert!(!g.conversations[0].automated);
    }

    #[test]
    fn topics_follow_reply_headers() {
        let metas = vec![
            B::new(1, "Urlaub planen", "max@y.de", &["paul@x.de"], 100).get(),
            B::new(2, "Re: Urlaub planen", "paul@x.de", &["max@y.de"], 200)
                .reply_to(1)
                .get(),
            B::new(3, "Etwas ganz anderes", "max@y.de", &["paul@x.de"], 300).get(),
        ];
        let g = group_by_topic(&metas, &me());
        assert_eq!(g.conversations.len(), 2);
        let t = g
            .conversations
            .iter()
            .find(|c| c.title == "Urlaub planen")
            .unwrap();
        assert_eq!(t.count, 2);
        assert_eq!(g.members[&t.key], [1, 2]);
    }

    #[test]
    fn a_reply_that_arrives_before_its_original_still_joins() {
        // the sent folder was read before the inbox
        let metas = vec![
            B::new(2, "Re: Urlaub", "paul@x.de", &["max@y.de"], 200)
                .reply_to(1)
                .get(),
            B::new(1, "Urlaub", "max@y.de", &["paul@x.de"], 100).get(),
        ];
        let g = group_by_topic(&metas, &me());
        assert_eq!(g.conversations.len(), 1);
        assert_eq!(g.members[&g.conversations[0].key], [1, 2]);
    }

    #[test]
    fn the_subject_joins_replies_whose_headers_were_lost() {
        let metas = vec![
            B::new(1, "Treffen am Freitag", "max@y.de", &["paul@x.de"], 100).get(),
            B::new(2, "AW: Treffen am Freitag", "paul@x.de", &["max@y.de"], 200).get(),
        ];
        assert_eq!(group_by_topic(&metas, &me()).conversations.len(), 1);
    }

    #[test]
    fn the_same_subject_from_different_people_is_not_one_topic() {
        let metas = vec![
            B::new(1, "Rechnung", "a@shop1.de", &["paul@x.de"], 100).get(),
            B::new(2, "Rechnung", "b@shop2.de", &["paul@x.de"], 200).get(),
        ];
        assert_eq!(group_by_topic(&metas, &me()).conversations.len(), 2);
    }

    #[test]
    fn the_same_subject_long_apart_is_a_new_topic() {
        let metas = vec![
            B::new(1, "Hallo", "max@y.de", &["paul@x.de"], 0).get(),
            B::new(2, "Hallo", "max@y.de", &["paul@x.de"], 200 * DAY).get(),
        ];
        assert_eq!(group_by_topic(&metas, &me()).conversations.len(), 2);
    }

    #[test]
    fn a_topic_lists_all_people_in_it() {
        let metas = vec![
            B::new(1, "Plan", "max@y.de", &["paul@x.de", "anna@z.de"], 100).get(),
            B::new(2, "Re: Plan", "anna@z.de", &["paul@x.de", "max@y.de"], 200)
                .reply_to(1)
                .get(),
        ];
        let g = group_by_topic(&metas, &me());
        assert_eq!(g.conversations[0].people.len(), 2);
        assert_eq!(g.conversations[0].kind, ConversationKind::Topic);
        assert!(g.conversations[0].key.starts_with("t-"));
    }

    #[test]
    fn newest_first_and_unread_counts_only_incoming() {
        let mut mine = B::new(2, "Re: Hi", "paul@x.de", &["max@y.de"], 900).get();
        mine.seen = false;
        let metas = vec![
            B::new(1, "Hi", "max@y.de", &["paul@x.de"], 100)
                .unseen()
                .get(),
            mine,
        ];
        let c = &group_by_person(&metas, &me()).conversations[0];
        assert_eq!(c.unread, 1);
        assert!(c.last_from_me);
        assert_eq!(c.preview, "snippet 2");
    }

    #[test]
    fn empty_input_gives_nothing() {
        assert!(group_by_person(&[], &me()).conversations.is_empty());
        assert!(group_by_topic(&[], &me()).conversations.is_empty());
    }
}
