//! The watched-folder source: receipts dropped into a directory as PDF, text, HTML or `.eml`.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use financer_store::Store;

use crate::config::{FolderConfig, OnDone, SourceKind};
use crate::docs::{DocResult, Documents};
use crate::error::SyncError;
use crate::message::{DocKind, MailReader};
use crate::reader::Trust;
use crate::summary::RunSummary;
use crate::text::sha256_hex;

/// Files changed more recently than this are still being copied.
const SETTLE: Duration = Duration::from_secs(2);
/// Largest file read.
const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
/// Files per run.
const MAX_FILES: usize = 200;

pub struct FolderSync;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileKind {
    Doc(DocKind),
    Mail,
}

impl FolderSync {
    fn kind_of(path: &Path) -> Option<FileKind> {
        match path.extension()?.to_str()?.to_lowercase().as_str() {
            "pdf" => Some(FileKind::Doc(DocKind::Pdf)),
            "html" | "htm" => Some(FileKind::Doc(DocKind::Html)),
            "txt" | "text" => Some(FileKind::Doc(DocKind::Text)),
            "eml" => Some(FileKind::Mail),
            _ => None,
        }
    }

    /// Files in the folder (not subfolders, not hidden files), oldest first.
    async fn candidates(dir: &Path, now: SystemTime) -> Result<Vec<PathBuf>, std::io::Error> {
        let mut rd = tokio::fs::read_dir(dir).await?;
        let mut files = Vec::new();
        while let Some(entry) = rd.next_entry().await? {
            let path = entry.path();
            let hidden = path
                .file_name()
                .and_then(|n| n.to_str())
                .is_none_or(|n| n.starts_with('.') || n.starts_with('~'));
            if hidden || Self::kind_of(&path).is_none() {
                continue;
            }
            let Ok(meta) = entry.metadata().await else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
            if now.duration_since(modified).unwrap_or_default() < SETTLE {
                continue; // still being written
            }
            files.push((modified, path));
        }
        files.sort();
        Ok(files.into_iter().map(|(_, p)| p).take(MAX_FILES).collect())
    }

    pub async fn run(store: &Store, cfg: &FolderConfig) -> Result<RunSummary, SyncError> {
        let mut summary = RunSummary::default();
        let meta = tokio::fs::metadata(&cfg.path).await.map_err(|e| {
            SyncError::other(format!(
                "cannot open the folder {}: {e}",
                cfg.path.display()
            ))
        })?;
        if !meta.is_dir() {
            return Err(SyncError::other(format!(
                "{} is not a folder",
                cfg.path.display()
            )));
        }
        let files = Self::candidates(&cfg.path, SystemTime::now())
            .await
            .map_err(|e| SyncError::other(format!("cannot read the folder: {e}")))?;

        for path in files {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string();
            let size = tokio::fs::metadata(&path)
                .await
                .map(|m| m.len())
                .unwrap_or(0);
            if size > MAX_FILE_BYTES {
                summary.skipped += 1;
                summary.note(format!("{name}: larger than 25 MB"));
                continue;
            }
            let data = match tokio::fs::read(&path).await {
                Ok(d) => d,
                Err(e) => {
                    summary.note(format!("{name}: cannot read ({e}); will try again"));
                    continue;
                }
            };
            let hash = sha256_hex(&data);

            let outcome = match store.seen_outcome(SourceKind::Folder.key(), &hash).await? {
                Some(previous) => previous,
                None => {
                    let outcome =
                        Self::import_file(store, &path, data, &name, &mut summary).await?;
                    store
                        .mark_seen(SourceKind::Folder.key(), &hash, &outcome)
                        .await?;
                    outcome
                }
            };
            // files that are not receipts stay where they are, remembered by content
            let is_receipt = outcome == "imported" || outcome == "duplicate";
            if cfg.on_done == OnDone::Move
                && is_receipt
                && Self::move_to_done(&path, &hash).await.is_err()
            {
                summary.note(format!(
                    "{name}: could not move it to done/; it is remembered and will not be imported twice"
                ));
            }
        }
        Ok(summary)
    }

    /// Returns the outcome word stored for the file's content hash.
    async fn import_file(
        store: &Store,
        path: &Path,
        data: Vec<u8>,
        name: &str,
        summary: &mut RunSummary,
    ) -> Result<String, SyncError> {
        let kind = Self::kind_of(path);
        let results: Vec<(String, DocResult)> = match kind {
            Some(FileKind::Doc(k)) => vec![(
                name.to_string(),
                Documents::import(store, SourceKind::Folder, k, data, None, None).await?,
            )],
            Some(FileKind::Mail) => {
                let mut out = Vec::new();
                if let Some(mail) = MailReader::parse(&data) {
                    for a in &mail.attachments {
                        out.push((
                            a.name.clone(),
                            Documents::import(
                                store,
                                SourceKind::Folder,
                                a.kind,
                                a.data.clone(),
                                None,
                                mail.date,
                            )
                            .await?,
                        ));
                    }
                    if out
                        .iter()
                        .all(|(_, r)| matches!(r, DocResult::Unreadable(_)))
                    {
                        if let Some(body) = &mail.body {
                            out.push((
                                "mail text".into(),
                                Documents::import_text(
                                    store,
                                    SourceKind::Folder,
                                    body,
                                    None,
                                    mail.date,
                                    Trust::Body,
                                )
                                .await?,
                            ));
                        }
                    }
                }
                out
            }
            None => Vec::new(),
        };

        let mut imported = 0;
        let mut duplicate = 0;
        let mut problem = None;
        for (what, res) in results {
            match res {
                DocResult::Imported(_) => imported += 1,
                DocResult::Duplicate => duplicate += 1,
                DocResult::Unreadable(why) => {
                    problem.get_or_insert(format!("{what}: {why}"));
                }
            }
        }
        summary.imported += imported;
        summary.duplicates += duplicate;
        if imported + duplicate > 0 {
            return Ok(if imported > 0 {
                "imported"
            } else {
                "duplicate"
            }
            .into());
        }
        summary.skipped += 1;
        let why = problem.unwrap_or_else(|| "no receipt found".into());
        summary.note(format!("{name}: {why}"));
        Ok(format!("unreadable: {why}"))
    }

    /// Move into `done/` next to the file, never overwriting.
    async fn move_to_done(path: &Path, hash: &str) -> std::io::Result<()> {
        let dir = path.parent().unwrap_or(Path::new(".")).join("done");
        tokio::fs::create_dir_all(&dir).await?;
        let name = path.file_name().unwrap_or_default();
        let mut target = dir.join(name);
        if tokio::fs::try_exists(&target).await? {
            let stem = Path::new(name)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("receipt");
            let ext = Path::new(name)
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            target = dir.join(format!("{stem}-{}.{ext}", &hash[..8]));
        }
        tokio::fs::rename(path, target).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::fixtures::{LIDL_PLUS, REWE_EBON};
    use crate::testing::{rewe_ebon_pdf, MailBuilder};

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "financer-folder-{name}-{}-{}",
            std::process::id(),
            &sha256_hex(name.as_bytes())[..6]
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Make a file look as if it had been there for a while.
    fn write_old(dir: &Path, name: &str, data: &[u8]) {
        let path = dir.join(name);
        std::fs::write(&path, data).unwrap();
        let old = SystemTime::now() - Duration::from_secs(60);
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(old)
            .unwrap();
    }

    fn cfg(dir: &Path, on_done: OnDone) -> FolderConfig {
        FolderConfig {
            enabled: true,
            path: dir.to_path_buf(),
            poll_seconds: 60,
            on_done,
        }
    }

    #[tokio::test]
    async fn imports_each_kind_of_file_once_and_keeps_them_by_default() {
        let dir = temp_dir("kinds");
        write_old(&dir, "rewe.pdf", &rewe_ebon_pdf());
        write_old(&dir, "lidl.txt", LIDL_PLUS.as_bytes());
        write_old(
            &dir,
            "bon.html",
            "<p>Edeka Müller</p><p>Brot 2,49 A</p><p>Summe 2,49</p><p>05.03.2026 09:10</p>"
                .as_bytes(),
        );
        write_old(
            &dir,
            "forwarded.eml",
            &MailBuilder::new("ebon@rewe.de", "eBon")
                .attach(
                    "x.pdf",
                    "application/pdf",
                    crate::testing::make_pdf(&[
                        "REWE",
                        "MILCH 1,09 B",
                        "SUMME\t1,09",
                        "Datum: 06.03.2026",
                    ]),
                )
                .build(),
        );
        write_old(&dir, "notes.docx", b"ignored");
        write_old(&dir, ".hidden.pdf", &rewe_ebon_pdf());

        let store = Store::connect("sqlite::memory:").await.unwrap();
        let s = FolderSync::run(&store, &cfg(&dir, OnDone::Keep))
            .await
            .unwrap();
        assert_eq!((s.imported, s.duplicates, s.skipped), (4, 0, 0), "{s:?}");
        assert!(store
            .receipt_metas()
            .await
            .unwrap()
            .iter()
            .all(|m| m.source == "folder"));
        assert!(dir.join("rewe.pdf").exists(), "keep leaves files alone");

        // second run: everything is remembered by content, nothing is read again
        let s = FolderSync::run(&store, &cfg(&dir, OnDone::Keep))
            .await
            .unwrap();
        assert_eq!((s.imported, s.duplicates, s.skipped), (0, 0, 0));
        assert_eq!(store.receipt_metas().await.unwrap().len(), 4);
        std::fs::remove_dir_all(dir).ok();
    }

    #[tokio::test]
    async fn move_mode_files_the_originals_under_done() {
        let dir = temp_dir("move");
        write_old(&dir, "rewe.pdf", &rewe_ebon_pdf());
        write_old(&dir, "again.pdf", &rewe_ebon_pdf());
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let s = FolderSync::run(&store, &cfg(&dir, OnDone::Move))
            .await
            .unwrap();
        // two files with the same content: read once, both filed away
        assert_eq!((s.imported, s.duplicates), (1, 0));
        assert!(!dir.join("rewe.pdf").exists() && !dir.join("again.pdf").exists());
        assert_eq!(std::fs::read_dir(dir.join("done")).unwrap().count(), 2);

        // the same file dropped again is moved without being imported again
        write_old(&dir, "rewe.pdf", &rewe_ebon_pdf());
        let s = FolderSync::run(&store, &cfg(&dir, OnDone::Move))
            .await
            .unwrap();
        assert_eq!(s.imported, 0);
        assert_eq!(std::fs::read_dir(dir.join("done")).unwrap().count(), 3);
        assert_eq!(store.receipt_metas().await.unwrap().len(), 1);
        std::fs::remove_dir_all(dir).ok();
    }

    #[tokio::test]
    async fn unreadable_files_are_reported_once_and_do_not_stop_the_rest() {
        let dir = temp_dir("bad");
        write_old(&dir, "broken.pdf", b"%PDF-1.4 truncated");
        write_old(
            &dir,
            "letter.txt",
            "Sehr geehrte Damen und Herren,\nvielen Dank.".as_bytes(),
        );
        write_old(&dir, "ok.txt", LIDL_PLUS.as_bytes());
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let s = FolderSync::run(&store, &cfg(&dir, OnDone::Keep))
            .await
            .unwrap();
        assert_eq!((s.imported, s.skipped), (1, 2));
        assert!(
            s.notes.iter().any(|n| n.starts_with("broken.pdf")),
            "{:?}",
            s.notes
        );
        let again = FolderSync::run(&store, &cfg(&dir, OnDone::Keep))
            .await
            .unwrap();
        assert_eq!(
            (again.imported, again.skipped),
            (0, 0),
            "not retried or re-reported"
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[tokio::test]
    async fn files_still_being_written_are_left_for_later() {
        let dir = temp_dir("fresh");
        std::fs::write(dir.join("new.txt"), REWE_EBON).unwrap(); // modified just now
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let s = FolderSync::run(&store, &cfg(&dir, OnDone::Keep))
            .await
            .unwrap();
        assert_eq!(s.imported, 0);
        std::fs::remove_dir_all(dir).ok();
    }

    #[tokio::test]
    async fn a_missing_folder_is_an_error_with_the_path() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let missing = std::env::temp_dir().join("financer-folder-does-not-exist-xyz");
        let e = FolderSync::run(&store, &cfg(&missing, OnDone::Keep))
            .await
            .unwrap_err();
        assert!(
            e.to_string().contains("financer-folder-does-not-exist-xyz"),
            "{e}"
        );
    }
}
