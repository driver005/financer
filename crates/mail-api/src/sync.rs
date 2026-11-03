//! Reading the mailbox: new messages of the inbox and the sent folder, stored once, with the
//! calendar events found in them. Folders are opened read-only (EXAMINE), so nothing is ever marked
//! as read on the server and nothing is ever deleted.

use financer_mail_core::{extract_events, fresh_text, MessageText};
use financer_mail_store::{NewMessage, Upsert};
use financer_receipt_sources::mail::Mailbox;
use serde::{Deserialize, Serialize};

use crate::config::MailConfig;
use crate::parse::parse_message;
use crate::state::{MailState, SyncReport, LAST_SYNC_KEY};

/// Messages downloaded per folder per run; the rest waits for the next one.
const MAX_PER_RUN: usize = 150;
/// The cursor is saved at least this often while downloading.
const SAVE_EVERY: usize = 25;

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("no mailbox is configured")]
    NotConfigured,
    #[error("a sync is already running")]
    Busy,
}

/// Where the last run of a folder stopped. UIDs only mean something together with UIDVALIDITY.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
struct Cursor {
    uid_validity: u32,
    last_uid: u32,
}

impl MailState {
    /// Reads new mail now. A failure of the server is part of the report, not an error: what was
    /// downloaded before it is kept.
    pub async fn sync_now(&self) -> Result<SyncReport, SyncError> {
        let cfg = self.config.clone().ok_or(SyncError::NotConfigured)?;
        let _gate = self.sync_gate.try_lock().map_err(|_| SyncError::Busy)?;
        let mut report = SyncReport {
            at: self.now(),
            ..Default::default()
        };
        match self
            .connector
            .connect(&cfg.imap_host, cfg.imap_port, &cfg.username, &cfg.password)
            .await
        {
            Err(e) => report.error = Some(e.to_string()),
            Ok(mut mailbox) => {
                for (folder, outgoing) in [(cfg.inbox.clone(), false), (cfg.sent.clone(), true)] {
                    if let Err(e) = self
                        .sync_folder(&cfg, mailbox.as_mut(), &folder, outgoing, &mut report)
                        .await
                    {
                        report.error.get_or_insert(format!("{folder}: {e}"));
                    }
                }
                mailbox.close().await;
            }
        }
        self.remember_sync(&report);
        if let Ok(json) = serde_json::to_string(&report) {
            let _ = self.store.set_setting(LAST_SYNC_KEY, &json).await;
        }
        Ok(report)
    }

    /// Offers the events found in a stored message to the calendar; returns how many were added or
    /// changed. An automated mail (a newsletter) may carry an invitation, but its prose is not an
    /// appointment.
    pub(crate) async fn record_events(
        &self,
        row: i64,
        message: &NewMessage,
        calendars: &[String],
    ) -> Result<u32, String> {
        let zone = self.zone();
        let now = self.now();
        let fresh = fresh_text(&message.body);
        let body = if message.automated {
            ""
        } else {
            fresh.text.as_str()
        };
        let events = extract_events(
            &MessageText {
                subject: &message.subject,
                body,
                date: message.sent_at,
                calendars,
            },
            zone,
            zone.to_local(now).date(),
        );
        let mut changed = 0;
        for e in events {
            match self
                .store
                .upsert_event(&e, Some(row), now)
                .await
                .map_err(|e| e.to_string())?
            {
                Upsert::Created | Upsert::Updated => changed += 1,
                Upsert::Unchanged | Upsert::Ignored => {}
            }
        }
        Ok(changed)
    }

    async fn cursor(&self, folder: &str) -> Cursor {
        self.store
            .get_setting(&format!("cursor:{folder}"))
            .await
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    async fn save_cursor(&self, folder: &str, cursor: Cursor) -> Result<(), String> {
        let json = serde_json::to_string(&cursor).map_err(|e| e.to_string())?;
        self.store
            .set_setting(&format!("cursor:{folder}"), &json)
            .await
            .map_err(|e| e.to_string())
    }

    async fn sync_folder(
        &self,
        cfg: &MailConfig,
        mailbox: &mut dyn Mailbox,
        folder: &str,
        outgoing: bool,
        report: &mut SyncReport,
    ) -> Result<(), String> {
        let info = mailbox
            .select(folder, true)
            .await
            .map_err(|e| e.to_string())?;
        let mut cursor = self.cursor(folder).await;
        // never synced: what is already in the mailbox starts as read, only later mail is "new"
        let first_run = cursor.uid_validity == 0;
        if cursor.uid_validity != info.uid_validity {
            cursor = Cursor {
                uid_validity: info.uid_validity,
                last_uid: 0,
            };
        }
        let after = (cursor.last_uid > 0).then_some(cursor.last_uid);
        let mut uids = mailbox
            .search(after, cfg.max_age_days)
            .await
            .map_err(|e| e.to_string())?;
        uids.sort_unstable();
        if uids.len() > MAX_PER_RUN {
            uids.truncate(MAX_PER_RUN);
            report.more = true;
        }
        let me = self.me();
        let now = self.now();
        let mut since_save = 0;
        let mut outcome = Ok(());
        for uid in uids {
            let raw = match mailbox.message(uid).await {
                Ok(raw) => raw,
                Err(e) => {
                    outcome = Err(e.to_string());
                    break;
                }
            };
            report.fetched += 1;
            match parse_message(&raw, folder, Some(uid), outgoing, &me, now) {
                None => report.skipped += 1,
                Some(mut parsed) => {
                    parsed.message.seen = parsed.message.outgoing || first_run;
                    match self
                        .store
                        .insert_message(&parsed.message, now)
                        .await
                        .map_err(|e| e.to_string())?
                    {
                        None => report.duplicates += 1,
                        Some(row) => {
                            report.stored += 1;
                            report.events += self
                                .record_events(row, &parsed.message, &parsed.calendars)
                                .await?;
                        }
                    }
                }
            }
            cursor.last_uid = uid;
            since_save += 1;
            if since_save >= SAVE_EVERY {
                self.save_cursor(folder, cursor).await?;
                since_save = 0;
            }
        }
        // saved also when the run failed half-way, so the next one continues where this stopped
        self.save_cursor(folder, cursor).await?;
        outcome
    }
}
