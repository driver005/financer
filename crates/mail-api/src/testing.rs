//! Fakes for tests: an IMAP server with folders, and a sender that records what it was given.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use financer_receipt_sources::mail::{
    MailError, Mailbox, MailboxConnector, MailboxInfo, MessageHeader,
};

use crate::smtp::{SendError, Sender};

#[derive(Default)]
struct FolderData {
    uid_validity: u32,
    next_uid: u32,
    messages: BTreeMap<u32, (Vec<u8>, i64)>,
}

#[derive(Default)]
struct Inner {
    folders: BTreeMap<String, FolderData>,
    fail_connect: Option<String>,
    fail_fetch_uid: Option<u32>,
    connects: usize,
    selected: Vec<(String, bool)>,
    fetched: Vec<(String, u32)>,
    login: Option<(String, String)>,
}

/// An in-memory mail server with several folders. Clones share the messages.
#[derive(Clone, Default)]
pub struct FakeImap {
    inner: Arc<Mutex<Inner>>,
}

impl FakeImap {
    pub fn new() -> FakeImap {
        FakeImap::default()
    }

    /// Adds a message to `folder`; `age_days` is how old the server thinks it is.
    pub fn deliver(&self, folder: &str, raw: &str, age_days: i64) -> u32 {
        let mut i = self.inner.lock().unwrap();
        let f = i
            .folders
            .entry(folder.to_string())
            .or_insert_with(|| FolderData {
                uid_validity: 1,
                next_uid: 1,
                ..Default::default()
            });
        let uid = f.next_uid;
        f.next_uid += 1;
        f.messages
            .insert(uid, (raw.replace('\n', "\r\n").into_bytes(), age_days));
        uid
    }

    pub fn renumber(&self, folder: &str, validity: u32) {
        let mut i = self.inner.lock().unwrap();
        if let Some(f) = i.folders.get_mut(folder) {
            f.uid_validity = validity;
            let old: Vec<_> = std::mem::take(&mut f.messages).into_values().collect();
            f.next_uid = 1;
            for m in old {
                let uid = f.next_uid;
                f.next_uid += 1;
                f.messages.insert(uid, m);
            }
        }
    }

    pub fn fail_next_connect(&self, message: &str) {
        self.inner.lock().unwrap().fail_connect = Some(message.into());
    }

    /// The download of this UID fails (once).
    pub fn fail_fetch(&self, uid: u32) {
        self.inner.lock().unwrap().fail_fetch_uid = Some(uid);
    }

    pub fn connects(&self) -> usize {
        self.inner.lock().unwrap().connects
    }

    /// Every folder opened, and whether read-only.
    pub fn selected(&self) -> Vec<(String, bool)> {
        self.inner.lock().unwrap().selected.clone()
    }

    pub fn fetched(&self) -> Vec<(String, u32)> {
        self.inner.lock().unwrap().fetched.clone()
    }

    pub fn last_login(&self) -> Option<(String, String)> {
        self.inner.lock().unwrap().login.clone()
    }
}

#[async_trait]
impl MailboxConnector for FakeImap {
    async fn connect(
        &self,
        _host: &str,
        _port: u16,
        username: &str,
        password: &str,
    ) -> Result<Box<dyn Mailbox>, MailError> {
        let mut i = self.inner.lock().unwrap();
        i.connects += 1;
        if let Some(m) = i.fail_connect.take() {
            return Err(MailError::Connect(m));
        }
        i.login = Some((username.into(), password.into()));
        Ok(Box::new(Session {
            inner: self.inner.clone(),
            folder: None,
        }))
    }
}

struct Session {
    inner: Arc<Mutex<Inner>>,
    folder: Option<String>,
}

#[async_trait]
impl Mailbox for Session {
    async fn select(&mut self, folder: &str, read_only: bool) -> Result<MailboxInfo, MailError> {
        let mut i = self.inner.lock().unwrap();
        i.selected.push((folder.to_string(), read_only));
        let f = i
            .folders
            .get(folder)
            .ok_or_else(|| MailError::Protocol(format!("no such folder {folder}")))?;
        let info = MailboxInfo {
            uid_validity: f.uid_validity,
            uid_next: f.next_uid,
        };
        self.folder = Some(folder.to_string());
        Ok(info)
    }

    async fn search(
        &mut self,
        after_uid: Option<u32>,
        max_age_days: u32,
    ) -> Result<Vec<u32>, MailError> {
        let i = self.inner.lock().unwrap();
        let f = &i.folders[self.folder.as_ref().expect("selected")];
        Ok(f.messages
            .iter()
            .filter(|(uid, (_, age))| match after_uid {
                Some(last) => **uid > last,
                None => *age <= i64::from(max_age_days),
            })
            .map(|(uid, _)| *uid)
            .collect())
    }

    async fn headers(&mut self, _uids: &[u32]) -> Result<Vec<MessageHeader>, MailError> {
        Ok(Vec::new())
    }

    async fn message(&mut self, uid: u32) -> Result<Vec<u8>, MailError> {
        let mut i = self.inner.lock().unwrap();
        let folder = self.folder.clone().expect("selected");
        if i.fail_fetch_uid == Some(uid) {
            i.fail_fetch_uid = None;
            return Err(MailError::Protocol("connection reset".into()));
        }
        i.fetched.push((folder.clone(), uid));
        i.folders[&folder]
            .messages
            .get(&uid)
            .map(|(raw, _)| raw.clone())
            .ok_or_else(|| MailError::Protocol(format!("no message {uid}")))
    }

    async fn mark_seen(&mut self, _uid: u32) -> Result<(), MailError> {
        panic!("the mail client must never change flags on the server");
    }

    async fn close(&mut self) {}
}

/// One message handed to [`FakeSender`].
#[derive(Debug, Clone)]
pub struct Sent {
    pub from: String,
    pub recipients: Vec<String>,
    pub raw: Vec<u8>,
}

/// Records what would have gone out over SMTP.
#[derive(Clone, Default)]
pub struct FakeSender {
    sent: Arc<Mutex<Vec<Sent>>>,
    fail: Arc<Mutex<Option<String>>>,
}

impl FakeSender {
    pub fn new() -> FakeSender {
        FakeSender::default()
    }
    pub fn sent(&self) -> Vec<Sent> {
        self.sent.lock().unwrap().clone()
    }
    pub fn fail_next(&self, message: &str) {
        *self.fail.lock().unwrap() = Some(message.into());
    }
}

#[async_trait]
impl Sender for FakeSender {
    async fn send(&self, from: &str, recipients: &[String], raw: Vec<u8>) -> Result<(), SendError> {
        if let Some(m) = self.fail.lock().unwrap().take() {
            return Err(SendError::Rejected(m));
        }
        self.sent.lock().unwrap().push(Sent {
            from: from.into(),
            recipients: recipients.to_vec(),
            raw,
        });
        Ok(())
    }
}
