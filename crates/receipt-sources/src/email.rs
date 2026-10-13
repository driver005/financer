//! The mailbox source: new messages from allowed senders, their PDFs and bodies, as receipts.

use std::collections::HashMap;

use financer_store::Store;
use serde::{Deserialize, Serialize};

use crate::config::{EmailConfig, SenderRule, SourceKind};
use crate::docs::{DocResult, Documents};
use crate::message::MailReader;
use crate::reader::Trust;
use crate::summary::RunSummary;

use crate::mail::{MailboxConnector, MessageHeader};

/// Messages looked at per run; the rest waits for the next poll.
const MAX_PER_RUN: usize = 200;

/// Where the last run stopped. UIDs are only meaningful together with the folder's UIDVALIDITY.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmailCursor {
    pub uid_validity: u32,
    pub last_uid: u32,
}

pub struct EmailRun {
    /// Progress to save, also when the run failed half-way.
    pub cursor: EmailCursor,
    pub summary: RunSummary,
    pub error: Option<String>,
}

/// Outcome of the documents of one message.
#[derive(Default)]
struct Tally {
    found: u32,
    first_problem: Option<String>,
}

impl Tally {
    fn add(&mut self, res: DocResult, name: &str, summary: &mut RunSummary) {
        match res {
            DocResult::Imported(_) => {
                summary.imported += 1;
                self.found += 1;
            }
            DocResult::Duplicate => {
                summary.duplicates += 1;
                self.found += 1;
            }
            DocResult::Unreadable(why) => {
                self.first_problem.get_or_insert(format!("{name}: {why}"));
            }
        }
    }
}

pub struct EmailSync;

impl EmailSync {
    pub async fn run(
        store: &Store,
        cfg: &EmailConfig,
        password: &str,
        connector: &dyn MailboxConnector,
        mut cursor: EmailCursor,
    ) -> EmailRun {
        let mut summary = RunSummary::default();
        let fail = |cursor, summary, e: String| EmailRun {
            cursor,
            summary,
            error: Some(e),
        };

        let mut mailbox = match connector
            .connect(&cfg.host, cfg.port, &cfg.username, password)
            .await
        {
            Ok(m) => m,
            Err(e) => return fail(cursor, summary, e.to_string()),
        };
        let info = match mailbox.select(&cfg.folder, !cfg.mark_seen).await {
            Ok(i) => i,
            Err(e) => {
                mailbox.close().await;
                return fail(cursor, summary, e.to_string());
            }
        };
        if cursor.uid_validity != info.uid_validity {
            if cursor.uid_validity != 0 {
                summary.note(
                    "The mail server renumbered the folder; looking through it again (receipts already stored are not duplicated).",
                );
            }
            cursor = EmailCursor {
                uid_validity: info.uid_validity,
                last_uid: 0,
            };
        }

        let rules = cfg.effective_senders();
        let result = Self::process(
            store,
            cfg,
            &rules,
            mailbox.as_mut(),
            &mut cursor,
            &mut summary,
        )
        .await;
        mailbox.close().await;
        EmailRun {
            cursor,
            summary,
            error: result.err(),
        }
    }

    async fn process(
        store: &Store,
        cfg: &EmailConfig,
        rules: &[SenderRule],
        mailbox: &mut dyn crate::mail::Mailbox,
        cursor: &mut EmailCursor,
        summary: &mut RunSummary,
    ) -> Result<(), String> {
        let after = (cursor.last_uid > 0).then_some(cursor.last_uid);
        let mut uids = mailbox
            .search(after, cfg.max_age_days)
            .await
            .map_err(|e| e.to_string())?;
        uids.truncate(MAX_PER_RUN);
        if uids.is_empty() {
            return Ok(());
        }
        let headers: HashMap<u32, MessageHeader> = mailbox
            .headers(&uids)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|h| (h.uid, h))
            .collect();

        for uid in uids {
            let rule = headers
                .get(&uid)
                .and_then(|h| MailReader::headers(&h.raw))
                .and_then(|m| {
                    let from = m.from?;
                    let subject = m.subject.unwrap_or_default();
                    rules
                        .iter()
                        .find(|r| r.matches_sender(&from) && r.matches_subject(&subject))
                        .cloned()
                });
            let Some(rule) = rule else {
                // not from a receipt sender: never downloaded
                cursor.last_uid = uid;
                continue;
            };

            let raw = mailbox.message(uid).await.map_err(|e| e.to_string())?;
            let kept = Self::import_message(store, &rule, &raw, summary)
                .await
                .map_err(|e| e.to_user_text())?;
            if kept && cfg.mark_seen {
                if let Err(e) = mailbox.mark_seen(uid).await {
                    summary.note(format!("could not mark message {uid} as read: {e}"));
                }
            }
            cursor.last_uid = uid;
        }
        Ok(())
    }

    /// Returns whether the message held a receipt (new or already stored).
    async fn import_message(
        store: &Store,
        rule: &SenderRule,
        raw: &[u8],
        summary: &mut RunSummary,
    ) -> Result<bool, crate::error::SyncError> {
        let Some(mail) = MailReader::parse(raw) else {
            summary.skipped += 1;
            summary.note("a message could not be read");
            return Ok(false);
        };
        let hint = Some(rule.retailer.as_str());
        let mut tally = Tally::default();

        for a in &mail.attachments {
            let res = Documents::import(
                store,
                SourceKind::Email,
                a.kind,
                a.data.clone(),
                hint,
                mail.date,
            )
            .await?;
            tally.add(res, &a.name, summary);
        }
        // the body only when no attachment was a receipt (the eBon often repeats itself there)
        if tally.found == 0 {
            if let Some(body) = &mail.body {
                let res = Documents::import_text(
                    store,
                    SourceKind::Email,
                    body,
                    hint,
                    mail.date,
                    Trust::Body,
                )
                .await?;
                tally.add(res, "mail text", summary);
            }
        }
        if tally.found == 0 {
            summary.skipped += 1;
            let subject = mail.subject.as_deref().unwrap_or("(no subject)");
            summary.note(format!(
                "no receipt in \"{}\" ({})",
                subject.chars().take(60).collect::<String>(),
                tally
                    .first_problem
                    .unwrap_or_else(|| "nothing to read".into())
            ));
        }
        Ok(tally.found > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::fixtures::{LIDL_PLUS, REWE_EBON};
    use crate::testing::{rewe_ebon_pdf, FakeMailbox, MailBuilder};

    fn cfg() -> EmailConfig {
        EmailConfig {
            enabled: true,
            host: "imap.example.org".into(),
            port: 993,
            username: "me@example.org".into(),
            password_env: "X".into(),
            folder: "INBOX".into(),
            poll_minutes: 30,
            mark_seen: false,
            max_age_days: 90,
            senders: Vec::new(),
        }
    }

    fn ebon_mail() -> Vec<u8> {
        MailBuilder::new(
            "REWE eBon <ebon@mailing.rewe.de>",
            "Dein REWE eBon vom 02.03.2026",
        )
        .text("Anbei dein eBon als PDF.")
        .attach("ebon_20260302.pdf", "application/pdf", rewe_ebon_pdf())
        .build()
    }

    fn newsletter() -> Vec<u8> {
        MailBuilder::new("Angebote <news@mailing.rewe.de>", "Die Angebote der Woche")
            .html("<h1>REWE Angebote</h1><p>Butter 1,99 B</p><p>Käse 2,49 B</p><p>SUMME 9,99</p>")
            .build()
    }

    fn spam() -> Vec<u8> {
        MailBuilder::new("deals@shop.example.net", "Gewinnspiel")
            .html("<p>Butter 1,99 B</p>")
            .build()
    }

    fn lidl_body_mail() -> Vec<u8> {
        MailBuilder::new("Lidl Plus <noreply@lidl.de>", "Dein Kassenbon")
            .date("Tue, 03 Mar 2026 10:00:00 +0100")
            .text(
                LIDL_PLUS
                    .replace("Rabatt Coupon -0,30\n", "")
                    .replace("4,47", "4,77")
                    .as_str(),
            )
            .build()
    }

    async fn run(
        store: &Store,
        mb: &FakeMailbox,
        cursor: EmailCursor,
        cfg: &EmailConfig,
    ) -> EmailRun {
        EmailSync::run(store, cfg, "pw", mb, cursor).await
    }

    #[tokio::test]
    async fn imports_receipt_mails_and_downloads_nothing_else() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mb = FakeMailbox::new(7);
        let ebon = mb.deliver(ebon_mail(), 3);
        let news = mb.deliver(newsletter(), 3);
        let junk = mb.deliver(spam(), 2);
        let lidl = mb.deliver(lidl_body_mail(), 1);

        let r = run(&store, &mb, EmailCursor::default(), &cfg()).await;
        assert_eq!(r.error, None);
        assert_eq!(
            (r.summary.imported, r.summary.duplicates),
            (2, 0),
            "{:?}",
            r.summary
        );
        // the newsletter parsed to a made-up total that does not add up: skipped, with a note
        assert_eq!(r.summary.skipped, 1);
        assert!(
            r.summary.notes[0].contains("Angebote der Woche"),
            "{:?}",
            r.summary.notes
        );
        assert_eq!(
            r.cursor,
            EmailCursor {
                uid_validity: 7,
                last_uid: lidl
            }
        );
        // the stranger's mail was never downloaded
        let fetched = mb.fetched();
        assert!(fetched.contains(&ebon) && fetched.contains(&news) && fetched.contains(&lidl));
        assert!(!fetched.contains(&junk));
        // read-only unless mark_seen is on, and the login came from the arguments
        assert_eq!(mb.selected_read_only(), Some(true));
        assert!(mb.marked_seen().is_empty());
        assert_eq!(
            mb.last_login(),
            Some(("me@example.org".into(), "pw".into()))
        );

        let metas = store.receipt_metas().await.unwrap();
        assert_eq!(metas.len(), 2);
        assert!(metas.iter().all(|m| m.source == "email"));
        let rewe = metas
            .iter()
            .find(|m| m.retailer.as_deref() == Some("rewe"))
            .unwrap();
        assert_eq!(
            (rewe.total_cents, rewe.time.as_deref()),
            (Some(784), Some("18:42"))
        );
        let lidl_r = metas
            .iter()
            .find(|m| m.retailer.as_deref() == Some("lidl"))
            .unwrap();
        // the date came from the receipt itself, not from the mail header
        assert_eq!(
            lidl_r.date.map(|d| d.to_string()).as_deref(),
            Some("2026-03-02")
        );
    }

    #[tokio::test]
    async fn second_run_only_looks_at_new_mail() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mb = FakeMailbox::new(7);
        mb.deliver(ebon_mail(), 3);
        let first = run(&store, &mb, EmailCursor::default(), &cfg()).await;
        assert_eq!(first.summary.imported, 1);

        let again = run(&store, &mb, first.cursor, &cfg()).await;
        assert_eq!((again.summary.imported, again.summary.skipped), (0, 0));
        assert_eq!(mb.fetched(), vec![1], "nothing was downloaded twice");

        // a new mail with a new receipt
        let second = MailBuilder::new("ebon@mailing.rewe.de", "Dein REWE eBon")
            .attach(
                "ebon.pdf",
                "application/pdf",
                crate::testing::make_pdf(&[
                    "REWE Markt GmbH",
                    "MILCH 1,09 B",
                    "SUMME EUR\t1,09",
                    "Datum: 05.03.2026",
                    "Uhrzeit: 08:15:00 Uhr",
                ]),
            )
            .build();
        mb.deliver(second, 0);
        let third = run(&store, &mb, again.cursor, &cfg()).await;
        assert_eq!(third.summary.imported, 1);
        assert_eq!(mb.fetched(), vec![1, 2]);
        assert_eq!(store.receipt_metas().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn renumbered_folder_is_rescanned_without_duplicates() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mb = FakeMailbox::new(7);
        mb.deliver(ebon_mail(), 3);
        let first = run(&store, &mb, EmailCursor::default(), &cfg()).await;
        mb.renumber(8);
        let again = run(&store, &mb, first.cursor, &cfg()).await;
        assert_eq!(again.cursor.uid_validity, 8);
        assert_eq!((again.summary.imported, again.summary.duplicates), (0, 1));
        assert!(again.summary.notes[0].contains("renumbered"));
        assert_eq!(store.receipt_metas().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn first_run_respects_max_age_days() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mb = FakeMailbox::new(1);
        mb.deliver(ebon_mail(), 200);
        let r = run(&store, &mb, EmailCursor::default(), &cfg()).await;
        assert_eq!(r.summary.imported, 0);
        let mut wide = cfg();
        wide.max_age_days = 365;
        let r = run(&store, &mb, EmailCursor::default(), &wide).await;
        assert_eq!(r.summary.imported, 1);
    }

    #[tokio::test]
    async fn connection_failure_keeps_the_cursor_and_reports_plainly() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mb = FakeMailbox::new(1);
        mb.deliver(ebon_mail(), 1);
        mb.fail_next_connect("connection refused");
        let cursor = EmailCursor {
            uid_validity: 1,
            last_uid: 0,
        };
        let r = run(&store, &mb, cursor, &cfg()).await;
        assert_eq!(r.cursor, cursor);
        let e = r.error.unwrap();
        assert!(e.contains("connection refused") && !e.contains("pw"), "{e}");
        // and the next run works
        assert_eq!(run(&store, &mb, cursor, &cfg()).await.summary.imported, 1);
    }

    #[tokio::test]
    async fn marks_receipt_mails_read_only_when_asked() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mb = FakeMailbox::new(1);
        let a = mb.deliver(ebon_mail(), 1);
        mb.deliver(newsletter(), 1);
        let mut c = cfg();
        c.mark_seen = true;
        run(&store, &mb, EmailCursor::default(), &c).await;
        assert_eq!(mb.selected_read_only(), Some(false));
        assert_eq!(
            mb.marked_seen(),
            vec![a],
            "only the mail that held a receipt"
        );
    }

    #[tokio::test]
    async fn custom_senders_replace_the_defaults() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let mb = FakeMailbox::new(1);
        // a forwarded eBon from the user's own address, with the receipt inline as text
        mb.deliver(
            MailBuilder::new("me@example.org", "Fwd: eBon")
                .text(REWE_EBON)
                .build(),
            1,
        );
        mb.deliver(ebon_mail(), 1);
        let mut c = cfg();
        c.senders = vec![SenderRule {
            retailer: "auto".into(),
            from: vec!["me@example.org".into()],
            subject_contains: vec!["ebon".into()],
        }];
        let r = run(&store, &mb, EmailCursor::default(), &c).await;
        assert_eq!(r.summary.imported, 1);
        assert_eq!(mb.fetched(), vec![1], "rewe.de is not allowed any more");
        let m = &store.receipt_metas().await.unwrap()[0];
        assert_eq!(
            m.retailer.as_deref(),
            Some("rewe"),
            "found in the receipt text"
        );
    }
}
