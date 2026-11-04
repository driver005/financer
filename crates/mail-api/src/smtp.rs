//! Sending. The [`Sender`] trait keeps the server out of the tests; [`SmtpSender`] is the real one.
//! Plain connections are refused: the password goes only over TLS (implicit, or STARTTLS before login).

use std::borrow::Cow;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use mail_send::smtp::message::{Address as SmtpAddress, Message};
use mail_send::SmtpClientBuilder;
use tokio_rustls::rustls;
use tokio_rustls::TlsConnector;

use crate::config::{MailConfig, SmtpSecurity};

#[derive(Debug, thiserror::Error)]
pub enum SendError {
    #[error("cannot reach the mail server: {0}")]
    Connect(String),
    #[error("the mail server refused the login: {0}")]
    Login(String),
    #[error("the mail server did not accept the message: {0}")]
    Rejected(String),
}

#[async_trait]
pub trait Sender: Send + Sync {
    /// Hands one message to the outgoing server. `raw` is the whole RFC 5322 message.
    async fn send(
        &self,
        envelope_from: &str,
        recipients: &[String],
        raw: Vec<u8>,
    ) -> Result<(), SendError>;
}

/// The outgoing server of the configuration.
pub struct SmtpSender {
    host: String,
    port: u16,
    security: SmtpSecurity,
    username: String,
    password: String,
    #[cfg(test)]
    plain_for_tests: bool,
}

const TIMEOUT: Duration = Duration::from_secs(60);

/// Certificates are checked against the Mozilla root list. The provider is named here, so the
/// build does not depend on which crypto features other crates switch on.
fn tls_connector() -> TlsConnector {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("the default TLS protocol versions are valid")
        .with_root_certificates(roots)
        .with_no_client_auth();
    TlsConnector::from(Arc::new(config))
}

impl SmtpSender {
    pub fn new(cfg: &MailConfig) -> SmtpSender {
        SmtpSender {
            host: cfg.smtp_host.clone(),
            port: cfg.smtp_port,
            security: cfg.smtp_security,
            username: cfg.username.clone(),
            password: cfg.password.clone(),
            #[cfg(test)]
            plain_for_tests: false,
        }
    }

    /// Server text without the password, short enough for a screen.
    fn clean(&self, e: impl std::fmt::Display) -> String {
        let mut s = e.to_string();
        if self.password.len() >= 4 {
            s = s.replace(&self.password, "***");
        }
        s.chars().take(200).collect()
    }
}

#[async_trait]
impl Sender for SmtpSender {
    async fn send(
        &self,
        envelope_from: &str,
        recipients: &[String],
        raw: Vec<u8>,
    ) -> Result<(), SendError> {
        let builder = SmtpClientBuilder::new_with_tls_connector(
            self.host.as_str(),
            self.port,
            tls_connector(),
        )
        .implicit_tls(self.security == SmtpSecurity::Tls)
        .credentials((self.username.as_str(), self.password.as_str()))
        .timeout(TIMEOUT);
        let message = Message {
            mail_from: SmtpAddress {
                email: Cow::Borrowed(envelope_from),
                ..Default::default()
            },
            rcpt_to: recipients
                .iter()
                .map(|r| SmtpAddress {
                    email: Cow::Borrowed(r.as_str()),
                    ..Default::default()
                })
                .collect(),
            body: Cow::Owned(raw),
        };
        let classify = |e: mail_send::Error, this: &SmtpSender| match e {
            mail_send::Error::AuthenticationFailed(r) => {
                SendError::Login(this.clean(format!("{} {}", r.code(), r.message())))
            }
            mail_send::Error::Auth(e) => SendError::Login(this.clean(e)),
            mail_send::Error::UnexpectedReply(r) => {
                SendError::Rejected(this.clean(format!("{} {}", r.code(), r.message())))
            }
            other @ (mail_send::Error::Io(_)
            | mail_send::Error::Tls(_)
            | mail_send::Error::Timeout
            | mail_send::Error::MissingStartTls
            | mail_send::Error::InvalidTLSName
            | mail_send::Error::UnparseableReply) => SendError::Connect(this.clean(other)),
            other => SendError::Rejected(this.clean(other)),
        };
        #[cfg(test)]
        if self.plain_for_tests {
            let mut client = builder
                .connect_plain()
                .await
                .map_err(|e| classify(e, self))?;
            client.send(message).await.map_err(|e| classify(e, self))?;
            let _ = client.quit().await;
            return Ok(());
        }
        let mut client = builder.connect().await.map_err(|e| classify(e, self))?;
        client.send(message).await.map_err(|e| classify(e, self))?;
        let _ = client.quit().await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine as _;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpListener;

    #[derive(Default, Debug)]
    struct Seen {
        auth: Option<String>,
        from: Option<String>,
        rcpt: Vec<String>,
        data: String,
        quit: bool,
    }

    /// A scripted SMTP server: one connection, `reject_rcpt` answers 550 to a recipient,
    /// `bad_password` answers 535 to the login.
    async fn server(
        reject_rcpt: Option<&'static str>,
        bad_password: bool,
    ) -> (u16, Arc<Mutex<Seen>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Seen::default()));
        let state = seen.clone();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (r, mut w) = stream.into_split();
            let mut lines = BufReader::new(r);
            w.write_all(b"220 test ESMTP\r\n").await.unwrap();
            let mut line = String::new();
            loop {
                line.clear();
                if lines.read_line(&mut line).await.unwrap() == 0 {
                    break;
                }
                let cmd = line.trim_end().to_string();
                let upper = cmd.to_uppercase();
                if upper.starts_with("EHLO") {
                    w.write_all(b"250-test\r\n250-AUTH PLAIN\r\n250 8BITMIME\r\n")
                        .await
                        .unwrap();
                } else if upper.starts_with("AUTH PLAIN") {
                    let token = cmd.split_whitespace().nth(2).unwrap_or("").to_string();
                    let decoded = base64::engine::general_purpose::STANDARD
                        .decode(token)
                        .unwrap_or_default();
                    state.lock().unwrap().auth =
                        Some(String::from_utf8_lossy(&decoded).replace('\0', "|"));
                    if bad_password {
                        w.write_all(b"535 5.7.8 Authentication failed\r\n")
                            .await
                            .unwrap();
                    } else {
                        w.write_all(b"235 2.7.0 ok\r\n").await.unwrap();
                    }
                } else if upper.starts_with("MAIL FROM") {
                    state.lock().unwrap().from = Some(cmd.clone());
                    w.write_all(b"250 ok\r\n").await.unwrap();
                } else if upper.starts_with("RCPT TO") {
                    if reject_rcpt.is_some_and(|r| cmd.contains(r)) {
                        w.write_all(b"550 5.1.1 no such user\r\n").await.unwrap();
                    } else {
                        state.lock().unwrap().rcpt.push(cmd.clone());
                        w.write_all(b"250 ok\r\n").await.unwrap();
                    }
                } else if upper == "DATA" {
                    w.write_all(b"354 go\r\n").await.unwrap();
                    let mut data = String::new();
                    loop {
                        line.clear();
                        lines.read_line(&mut line).await.unwrap();
                        if line == ".\r\n" {
                            break;
                        }
                        data.push_str(&line);
                    }
                    state.lock().unwrap().data = data;
                    w.write_all(b"250 queued\r\n").await.unwrap();
                } else if upper == "QUIT" {
                    state.lock().unwrap().quit = true;
                    w.write_all(b"221 bye\r\n").await.unwrap();
                    break;
                } else {
                    w.write_all(b"500 what\r\n").await.unwrap();
                }
            }
        });
        (port, seen)
    }

    fn sender(port: u16) -> SmtpSender {
        SmtpSender {
            host: "127.0.0.1".into(),
            port,
            security: SmtpSecurity::Tls,
            username: "paul@example.org".into(),
            password: "app-password-1234".into(),
            plain_for_tests: true,
        }
    }

    #[tokio::test]
    async fn delivers_with_login_envelope_and_dot_stuffing() {
        let (port, seen) = server(None, false).await;
        let raw = b"From: paul@example.org\r\nTo: max@y.de\r\nSubject: x\r\n\r\nline\r\n.starts with a dot\r\n".to_vec();
        sender(port)
            .send(
                "paul@example.org",
                &["max@y.de".into(), "boss@example.org".into()],
                raw,
            )
            .await
            .unwrap();
        let s = seen.lock().unwrap();
        assert_eq!(
            s.auth.as_deref(),
            Some("|paul@example.org|app-password-1234")
        );
        assert!(
            s.from.as_deref().unwrap().contains("<paul@example.org>"),
            "{:?}",
            s.from
        );
        assert_eq!(s.rcpt.len(), 2);
        assert!(s.rcpt[1].contains("<boss@example.org>"));
        assert!(s.data.contains("Subject: x"));
        assert!(
            s.data.contains("..starts with a dot"),
            "a leading dot is doubled on the wire: {:?}",
            s.data
        );
        assert!(s.quit);
    }

    #[tokio::test]
    async fn a_refused_login_is_a_login_error_without_the_password() {
        let (port, _) = server(None, true).await;
        let err = sender(port)
            .send("paul@example.org", &["max@y.de".into()], b"x".to_vec())
            .await
            .unwrap_err();
        assert!(matches!(err, SendError::Login(_)), "{err:?}");
        assert!(!err.to_string().contains("app-password-1234"));
    }

    #[tokio::test]
    async fn a_refused_recipient_is_reported() {
        let (port, _) = server(Some("nobody@y.de"), false).await;
        let err = sender(port)
            .send("paul@example.org", &["nobody@y.de".into()], b"x".to_vec())
            .await
            .unwrap_err();
        assert!(
            matches!(err, SendError::Rejected(ref m) if m.contains("550")),
            "{err:?}"
        );
    }

    #[tokio::test]
    async fn an_unreachable_server_is_a_connect_error() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let err = sender(port)
            .send("paul@example.org", &["max@y.de".into()], b"x".to_vec())
            .await
            .unwrap_err();
        assert!(matches!(err, SendError::Connect(_)), "{err:?}");
    }
}
