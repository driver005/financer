//! Fixtures and fakes for tests (also used by the API crate's tests). Nothing here talks to a
//! network, and nothing in it is real data.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;

use crate::mail::{Mailbox, MailboxConnector, MailboxInfo, MailError, MessageHeader};

/// A small text PDF: one line of text per entry, Helvetica, one page. A line may contain a tab
/// to put the rest of it in a right-hand column, the way receipts print prices.
pub fn make_pdf(lines: &[&str]) -> Vec<u8> {
    fn escape(s: &str) -> String {
        let mut out = String::new();
        for c in s.chars() {
            match c {
                '(' | ')' | '\\' => {
                    out.push('\\');
                    out.push(c);
                }
                'ä' => out.push_str("\\344"),
                'ö' => out.push_str("\\366"),
                'ü' => out.push_str("\\374"),
                'Ä' => out.push_str("\\304"),
                'Ö' => out.push_str("\\326"),
                'Ü' => out.push_str("\\334"),
                'ß' => out.push_str("\\337"),
                '€' => out.push_str("\\200"),
                c if c.is_ascii() => out.push(c),
                _ => out.push('?'),
            }
        }
        out
    }
    let mut content = String::from("BT\n/F1 10 Tf\n12 TL\n");
    let mut y = 800;
    for line in lines {
        match line.split_once('\t') {
            Some((left, right)) => {
                content.push_str(&format!("1 0 0 1 40 {y} Tm ({}) Tj\n", escape(left)));
                content.push_str(&format!("1 0 0 1 300 {y} Tm ({}) Tj\n", escape(right)));
            }
            None => content.push_str(&format!("1 0 0 1 40 {y} Tm ({}) Tj\n", escape(line))),
        }
        y -= 12;
    }
    content.push_str("ET\n");

    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 842] /Contents 4 0 R \
         /Resources << /Font << /F1 5 0 R >> >> >>"
            .to_string(),
        format!(
            "<< /Length {} >>\nstream\n{}endstream",
            content.len(),
            content
        ),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
            .to_string(),
    ];
    let mut pdf: Vec<u8> = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", i + 1, body).as_bytes());
    }
    let xref = pdf.len();
    pdf.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for o in offsets {
        pdf.extend_from_slice(format!("{o:010} 00000 n \n").as_bytes());
    }
    pdf.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    pdf
}

/// The lines of the REWE eBon fixture as PDF text with prices in a right-hand column.
pub fn rewe_ebon_pdf() -> Vec<u8> {
    make_pdf(&[
        "REWE Markt GmbH",
        "Musterstr. 1",
        "50667 Köln",
        "UID Nr.: DE812706034",
        "BIO VOLLMILCH 3,5%\t1,19 B",
        "SPAGHETTI 500G\t0,89 A",
        "BANANEN\t1,49 B",
        "EIER BODENHALTUNG 10ER\t2,29 B",
        "JOGHURT NATUR",
        "2 Stk x 0,99\t1,98 B",
        "-----------------------------",
        "SUMME EUR\t7,84",
        "Geg. Visa EUR\t7,84",
        "Datum: 02.03.2026",
        "Uhrzeit: 18:42:07 Uhr",
        "Bon-Nr. 1234",
        "Vielen Dank für Ihren Einkauf!",
    ])
}

/// A raw RFC 822 message as a mail server would hand it over.
pub struct MailBuilder {
    from: String,
    subject: String,
    date: String,
    text: Option<String>,
    html: Option<String>,
    attachments: Vec<(String, String, Vec<u8>)>,
}

impl MailBuilder {
    pub fn new(from: &str, subject: &str) -> Self {
        MailBuilder {
            from: from.into(),
            subject: subject.into(),
            date: "Mon, 02 Mar 2026 18:45:12 +0100".into(),
            text: None,
            html: None,
            attachments: Vec::new(),
        }
    }

    pub fn date(mut self, rfc2822: &str) -> Self {
        self.date = rfc2822.into();
        self
    }

    pub fn text(mut self, text: &str) -> Self {
        self.text = Some(text.into());
        self
    }

    pub fn html(mut self, html: &str) -> Self {
        self.html = Some(html.into());
        self
    }

    pub fn attach(mut self, name: &str, mime: &str, data: Vec<u8>) -> Self {
        self.attachments.push((name.into(), mime.into(), data));
        self
    }

    fn wrap_base64(data: &[u8]) -> String {
        STANDARD
            .encode(data)
            .as_bytes()
            .chunks(76)
            .map(|c| std::str::from_utf8(c).unwrap())
            .collect::<Vec<_>>()
            .join("\r\n")
    }

    pub fn build(self) -> Vec<u8> {
        let mut m = String::new();
        m.push_str(&format!("From: {}\r\n", self.from));
        m.push_str("To: me@example.org\r\n");
        m.push_str(&format!("Subject: {}\r\n", self.subject));
        m.push_str(&format!("Date: {}\r\n", self.date));
        m.push_str("Message-ID: <fixture@example.org>\r\nMIME-Version: 1.0\r\n");
        m.push_str("Content-Type: multipart/mixed; boundary=\"outer\"\r\n\r\n");
        m.push_str("--outer\r\nContent-Type: multipart/alternative; boundary=\"alt\"\r\n\r\n");
        if let Some(t) = &self.text {
            m.push_str("--alt\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n");
            m.push_str(&Self::wrap_base64(t.as_bytes()));
            m.push_str("\r\n");
        }
        if let Some(h) = &self.html {
            m.push_str("--alt\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n");
            m.push_str(&Self::wrap_base64(h.as_bytes()));
            m.push_str("\r\n");
        }
        if self.text.is_none() && self.html.is_none() {
            m.push_str("--alt\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSiehe Anhang.\r\n");
        }
        m.push_str("--alt--\r\n");
        for (name, mime, data) in &self.attachments {
            m.push_str(&format!(
                "--outer\r\nContent-Type: {mime}; name=\"{name}\"\r\nContent-Disposition: attachment; filename=\"{name}\"\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            ));
            m.push_str(&Self::wrap_base64(data));
            m.push_str("\r\n");
        }
        m.push_str("--outer--\r\n");
        m.into_bytes()
    }
}

/// An in-memory mailbox. Clones share the same messages, so a test can add mail after the
/// syncer was built.
#[derive(Clone, Default)]
pub struct FakeMailbox {
    inner: Arc<Mutex<FakeMailboxInner>>,
}

#[derive(Default)]
struct FakeMailboxInner {
    uid_validity: u32,
    messages: BTreeMap<u32, FakeMessage>,
    next_uid: u32,
    /// Fail the next connection with this message.
    fail_connect: Option<String>,
    fetched: Vec<u32>,
    seen: Vec<u32>,
    connects: usize,
    last_login: Option<(String, String)>,
    selected_read_only: Option<bool>,
}

struct FakeMessage {
    raw: Vec<u8>,
    /// Day the server received it, as days before "today" for the SINCE search.
    age_days: i64,
}

impl FakeMailbox {
    pub fn new(uid_validity: u32) -> Self {
        let m = FakeMailbox::default();
        {
            let mut i = m.inner.lock().unwrap();
            i.uid_validity = uid_validity;
            i.next_uid = 1;
        }
        m
    }

    /// Add a message; returns its UID.
    pub fn deliver(&self, raw: Vec<u8>, age_days: i64) -> u32 {
        let mut i = self.inner.lock().unwrap();
        let uid = i.next_uid;
        i.next_uid += 1;
        i.messages.insert(uid, FakeMessage { raw, age_days });
        uid
    }

    /// The server renumbered the mailbox: new UIDVALIDITY and UIDs start again.
    pub fn renumber(&self, new_validity: u32) {
        let mut i = self.inner.lock().unwrap();
        i.uid_validity = new_validity;
        let old: Vec<_> = std::mem::take(&mut i.messages).into_values().collect();
        i.next_uid = 1;
        for m in old {
            let uid = i.next_uid;
            i.next_uid += 1;
            i.messages.insert(uid, m);
        }
    }

    pub fn fail_next_connect(&self, message: &str) {
        self.inner.lock().unwrap().fail_connect = Some(message.into());
    }

    /// UIDs whose full message was downloaded (headers alone do not count).
    pub fn fetched(&self) -> Vec<u32> {
        self.inner.lock().unwrap().fetched.clone()
    }

    pub fn marked_seen(&self) -> Vec<u32> {
        self.inner.lock().unwrap().seen.clone()
    }

    pub fn connects(&self) -> usize {
        self.inner.lock().unwrap().connects
    }

    /// Whether the folder was opened read-only the last time (`None` before any session).
    pub fn selected_read_only(&self) -> Option<bool> {
        self.inner.lock().unwrap().selected_read_only
    }

    pub fn last_login(&self) -> Option<(String, String)> {
        self.inner.lock().unwrap().last_login.clone()
    }
}

#[async_trait]
impl MailboxConnector for FakeMailbox {
    async fn connect(
        &self,
        _host: &str,
        _port: u16,
        username: &str,
        password: &str,
    ) -> Result<Box<dyn Mailbox>, MailError> {
        let mut i = self.inner.lock().unwrap();
        i.connects += 1;
        if let Some(msg) = i.fail_connect.take() {
            return Err(MailError::Connect(msg));
        }
        i.last_login = Some((username.into(), password.into()));
        Ok(Box::new(FakeSession {
            inner: self.inner.clone(),
        }))
    }
}

struct FakeSession {
    inner: Arc<Mutex<FakeMailboxInner>>,
}

#[async_trait]
impl Mailbox for FakeSession {
    async fn select(&mut self, _folder: &str, read_only: bool) -> Result<MailboxInfo, MailError> {
        self.inner.lock().unwrap().selected_read_only = Some(read_only);
        let i = self.inner.lock().unwrap();
        Ok(MailboxInfo {
            uid_validity: i.uid_validity,
            uid_next: i.next_uid,
        })
    }

    async fn search(
        &mut self,
        after_uid: Option<u32>,
        max_age_days: u32,
    ) -> Result<Vec<u32>, MailError> {
        let i = self.inner.lock().unwrap();
        Ok(i.messages
            .iter()
            .filter(|(uid, m)| match after_uid {
                Some(last) => **uid > last,
                None => m.age_days <= i64::from(max_age_days),
            })
            .map(|(uid, _)| *uid)
            .collect())
    }

    async fn headers(&mut self, uids: &[u32]) -> Result<Vec<MessageHeader>, MailError> {
        let i = self.inner.lock().unwrap();
        Ok(uids
            .iter()
            .filter_map(|uid| i.messages.get(uid).map(|m| (uid, m)))
            .map(|(uid, m)| MessageHeader {
                uid: *uid,
                raw: header_block(&m.raw),
            })
            .collect())
    }

    async fn message(&mut self, uid: u32) -> Result<Vec<u8>, MailError> {
        let mut i = self.inner.lock().unwrap();
        i.fetched.push(uid);
        i.messages
            .get(&uid)
            .map(|m| m.raw.clone())
            .ok_or_else(|| MailError::Protocol(format!("no message {uid}")))
    }

    async fn mark_seen(&mut self, uid: u32) -> Result<(), MailError> {
        self.inner.lock().unwrap().seen.push(uid);
        Ok(())
    }

    async fn close(&mut self) {}
}

/// Header block of a raw message (everything up to and including the first blank line).
fn header_block(raw: &[u8]) -> Vec<u8> {
    let end = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map_or(raw.len(), |p| p + 4);
    raw[..end].to_vec()
}

/// Hand-written JSON in the shapes the open-source Lidl Plus client documents (see
/// `fixtures/lidl/` and docs/RECEIPT_SOURCES.md). None of it was recorded from Lidl.
pub mod lidl_fixtures {
    pub const TOKEN: &str = include_str!("../fixtures/lidl/token.json");
    pub const TOKEN_REFRESHED: &str = include_str!("../fixtures/lidl/token_refreshed.json");
    pub const TOKEN_INVALID_GRANT: &str = include_str!("../fixtures/lidl/token_invalid_grant.json");
    pub const TICKETS_PAGE_1: &str = include_str!("../fixtures/lidl/tickets_page1.json");
    pub const TICKETS_PAGE_2: &str = include_str!("../fixtures/lidl/tickets_page2.json");
    pub const TICKET_1: &str = include_str!("../fixtures/lidl/ticket_0001.json");
    pub const TICKET_2: &str = include_str!("../fixtures/lidl/ticket_0002.json");
    pub const TICKET_3: &str = include_str!("../fixtures/lidl/ticket_0003.json");
}

/// A stand-in for Lidl's servers: answers from a list of canned responses and records every
/// request. A route matches when the method is equal and the URL contains the given text. Several
/// responses for one route are served in the order they were added; the last one then repeats.
#[derive(Default)]
pub struct FakeLidlHttp {
    routes: Mutex<Vec<FakeRoute>>,
    requests: Mutex<Vec<crate::lidl::HttpRequest>>,
}

struct FakeRoute {
    method: crate::lidl::Method,
    url_contains: String,
    status: u16,
    body: String,
    used: bool,
}

impl FakeLidlHttp {
    pub fn respond(&self, method: crate::lidl::Method, url_contains: &str, status: u16, body: &str) {
        self.routes.lock().unwrap().push(FakeRoute {
            method,
            url_contains: url_contains.into(),
            status,
            body: body.into(),
            used: false,
        });
    }

    pub fn requests(&self) -> Vec<crate::lidl::HttpRequest> {
        self.requests.lock().unwrap().clone()
    }
}

#[async_trait]
impl crate::lidl::LidlHttp for FakeLidlHttp {
    async fn send(
        &self,
        req: crate::lidl::HttpRequest,
    ) -> Result<crate::lidl::HttpResponse, crate::lidl::LidlError> {
        let mut routes = self.routes.lock().unwrap();
        let matching: Vec<usize> = routes
            .iter()
            .enumerate()
            .filter(|(_, r)| r.method == req.method && req.url.contains(&r.url_contains))
            .map(|(i, _)| i)
            .collect();
        let pick = matching
            .iter()
            .find(|i| !routes[**i].used)
            .or(matching.last())
            .copied();
        let url = req.url.clone();
        self.requests.lock().unwrap().push(req);
        match pick {
            Some(i) => {
                routes[i].used = true;
                Ok(crate::lidl::HttpResponse {
                    status: routes[i].status,
                    body: routes[i].body.clone(),
                })
            }
            None => Err(crate::lidl::LidlError::Network(format!(
                "no fake response for {url}"
            ))),
        }
    }
}
