//! The mailbox, hidden behind two small traits so the sync logic can be tested with a fake
//! holding real-looking messages, plus the real IMAP implementation (implicit TLS via rustls).

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures_util::TryStreamExt;
use tokio::net::TcpStream;
use tokio_rustls::client::TlsStream;
use tokio_rustls::rustls;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::TlsConnector;

/// Longest a connect or a single IMAP command may take.
const TIMEOUT: Duration = Duration::from_secs(60);
/// UIDs per FETCH command.
const FETCH_BATCH: usize = 100;
/// Largest message downloaded.
pub const MAX_MESSAGE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum MailError {
    #[error("cannot connect to the mail server: {0}")]
    Connect(String),
    #[error("the mail server refused the login: {0}")]
    Login(String),
    #[error("mail server error: {0}")]
    Protocol(String),
}

/// What `SELECT` told us about the folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MailboxInfo {
    pub uid_validity: u32,
    pub uid_next: u32,
}

/// The header block of one message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageHeader {
    pub uid: u32,
    pub raw: Vec<u8>,
}

/// One logged-in IMAP session.
#[async_trait]
pub trait Mailbox: Send {
    /// Open `folder`. `read_only` uses EXAMINE, which cannot change any flag; marking mails as
    /// read needs a writable SELECT.
    async fn select(&mut self, folder: &str, read_only: bool) -> Result<MailboxInfo, MailError>;
    /// UIDs, ascending. With `after_uid`, only those greater than it; without, only messages
    /// received within `max_age_days`.
    async fn search(&mut self, after_uid: Option<u32>, max_age_days: u32) -> Result<Vec<u32>, MailError>;
    /// Headers only: messages that are not receipt mails are never downloaded.
    async fn headers(&mut self, uids: &[u32]) -> Result<Vec<MessageHeader>, MailError>;
    /// The whole message, without marking it read.
    async fn message(&mut self, uid: u32) -> Result<Vec<u8>, MailError>;
    async fn mark_seen(&mut self, uid: u32) -> Result<(), MailError>;
    async fn close(&mut self);
}

/// Opens sessions. The password is only ever passed here, from the environment.
#[async_trait]
pub trait MailboxConnector: Send + Sync {
    async fn connect(
        &self,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
    ) -> Result<Box<dyn Mailbox>, MailError>;
}

/// Real IMAP over implicit TLS (port 993 style). STARTTLS and plain connections are not
/// supported on purpose: the password must not travel unencrypted.
pub struct ImapConnector {
    tls: TlsConnector,
}

impl ImapConnector {
    pub fn new() -> Self {
        let mut roots = rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let config = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .expect("the default TLS protocol versions are valid")
            .with_root_certificates(roots)
            .with_no_client_auth();
        ImapConnector {
            tls: TlsConnector::from(Arc::new(config)),
        }
    }
}

impl Default for ImapConnector {
    fn default() -> Self {
        Self::new()
    }
}

/// Keep server text short and free of anything that looks like the secret.
fn clean(msg: impl std::fmt::Display, secret: &str) -> String {
    let mut s = msg.to_string();
    if secret.len() >= 4 {
        s = s.replace(secret, "***");
    }
    s.chars().take(200).collect()
}

#[async_trait]
impl MailboxConnector for ImapConnector {
    async fn connect(
        &self,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
    ) -> Result<Box<dyn Mailbox>, MailError> {
        let connect = async {
            let tcp = TcpStream::connect((host, port))
                .await
                .map_err(|e| MailError::Connect(clean(e, password)))?;
            let name = ServerName::try_from(host.to_string())
                .map_err(|_| MailError::Connect(format!("{host} is not a valid host name")))?;
            let tls = self
                .tls
                .connect(name, tcp)
                .await
                .map_err(|e| MailError::Connect(format!("TLS: {}", clean(e, password))))?;
            let mut client = async_imap::Client::new(tls);
            client
                .read_response()
                .await
                .map_err(|e| MailError::Connect(clean(e, password)))?
                .ok_or_else(|| MailError::Connect("the server closed the connection".into()))?;
            let session = client
                .login(username, password)
                .await
                .map_err(|(e, _)| MailError::Login(clean(e, password)))?;
            Ok::<_, MailError>(session)
        };
        let session = tokio::time::timeout(TIMEOUT, connect)
            .await
            .map_err(|_| MailError::Connect("timed out".into()))??;
        Ok(Box::new(ImapSession {
            session,
            secret: password.to_string(),
        }))
    }
}

struct ImapSession {
    session: async_imap::Session<TlsStream<TcpStream>>,
    secret: String,
}

impl ImapSession {
    fn err(&self, e: impl std::fmt::Display) -> MailError {
        MailError::Protocol(clean(e, &self.secret))
    }
}

fn uid_set(uids: &[u32]) -> String {
    uids.iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

/// `02-Mar-2026`, the date format of IMAP SEARCH.
fn imap_date(date: time::Date) -> String {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    format!(
        "{:02}-{}-{}",
        date.day(),
        MONTHS[u8::from(date.month()) as usize - 1],
        date.year()
    )
}

#[async_trait]
impl Mailbox for ImapSession {
    async fn select(&mut self, folder: &str, read_only: bool) -> Result<MailboxInfo, MailError> {
        let opened = tokio::time::timeout(TIMEOUT, async {
            if read_only {
                self.session.examine(folder).await
            } else {
                self.session.select(folder).await
            }
        })
        .await
        .map_err(|_| MailError::Protocol("timed out".into()))?;
        let mb = opened.map_err(|e| self.err(e))?;
        Ok(MailboxInfo {
            uid_validity: mb
                .uid_validity
                .ok_or_else(|| MailError::Protocol("the server sent no UIDVALIDITY".into()))?,
            uid_next: mb.uid_next.unwrap_or(0),
        })
    }

    async fn search(
        &mut self,
        after_uid: Option<u32>,
        max_age_days: u32,
    ) -> Result<Vec<u32>, MailError> {
        let query = match after_uid {
            Some(last) => format!("UID {}:*", last.saturating_add(1)),
            None => {
                let since = time::OffsetDateTime::now_utc().date()
                    - time::Duration::days(i64::from(max_age_days));
                format!("SINCE {}", imap_date(since))
            }
        };
        let found = tokio::time::timeout(TIMEOUT, self.session.uid_search(&query))
            .await
            .map_err(|_| MailError::Protocol("timed out".into()))?
            .map_err(|e| self.err(e))?;
        let mut uids: Vec<u32> = found
            .into_iter()
            // "UID n:*" always includes the newest message, even when it is older than n
            .filter(|u| after_uid.is_none_or(|last| *u > last))
            .collect();
        uids.sort_unstable();
        Ok(uids)
    }

    async fn headers(&mut self, uids: &[u32]) -> Result<Vec<MessageHeader>, MailError> {
        let mut out = Vec::new();
        for chunk in uids.chunks(FETCH_BATCH) {
            let fetched = tokio::time::timeout(TIMEOUT, async {
                let stream = self
                    .session
                    .uid_fetch(uid_set(chunk), "(UID BODY.PEEK[HEADER])")
                    .await?;
                stream.try_collect::<Vec<_>>().await
            })
            .await
            .map_err(|_| MailError::Protocol("timed out".into()))?
            .map_err(|e| self.err(e))?;
            for f in fetched {
                if let (Some(uid), Some(h)) = (f.uid, f.header()) {
                    out.push(MessageHeader {
                        uid,
                        raw: h.to_vec(),
                    });
                }
            }
        }
        Ok(out)
    }

    async fn message(&mut self, uid: u32) -> Result<Vec<u8>, MailError> {
        let fetched = tokio::time::timeout(TIMEOUT * 2, async {
            let stream = self
                .session
                .uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")
                .await?;
            stream.try_collect::<Vec<_>>().await
        })
        .await
        .map_err(|_| MailError::Protocol("timed out".into()))?
        .map_err(|e| self.err(e))?;
        let body = fetched
            .iter()
            .find_map(|f| f.body())
            .ok_or_else(|| MailError::Protocol(format!("message {uid} has no body")))?;
        if body.len() > MAX_MESSAGE_BYTES {
            return Err(MailError::Protocol(format!(
                "message {uid} is larger than {} MB",
                MAX_MESSAGE_BYTES / 1024 / 1024
            )));
        }
        Ok(body.to_vec())
    }

    async fn mark_seen(&mut self, uid: u32) -> Result<(), MailError> {
        tokio::time::timeout(TIMEOUT, async {
            let stream = self
                .session
                .uid_store(uid.to_string(), "+FLAGS (\\Seen)")
                .await?;
            stream.try_collect::<Vec<_>>().await?;
            Ok::<_, async_imap::error::Error>(())
        })
        .await
        .map_err(|_| MailError::Protocol("timed out".into()))?
        .map_err(|e| self.err(e))
    }

    async fn close(&mut self) {
        let _ = tokio::time::timeout(Duration::from_secs(10), self.session.logout()).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn imap_dates_and_uid_sets() {
        assert_eq!(imap_date(date!(2026 - 03 - 02)), "02-Mar-2026");
        assert_eq!(imap_date(date!(2025 - 12 - 31)), "31-Dec-2025");
        assert_eq!(uid_set(&[3, 5, 9]), "3,5,9");
    }

    #[test]
    fn server_text_never_carries_the_password() {
        let s = clean("LOGIN failed for hunter22secret", "hunter22secret");
        assert!(!s.contains("hunter22secret"), "{s}");
        assert!(clean("x".repeat(500), "pw").len() <= 200);
    }
}
