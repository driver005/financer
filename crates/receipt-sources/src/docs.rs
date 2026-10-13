//! One document (PDF, HTML, text) to a stored receipt. Shared by the mailbox and the folder.

use financer_store::Store;
use time::Date;

use crate::config::SourceKind;
use crate::error::SyncError;
use crate::ingest::{Ingest, Stored};
use crate::message::DocKind;
use crate::reader::{ReceiptReader, Trust};
use crate::text::{html_to_text, pdf_to_text};

/// What became of one document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocResult {
    Imported(i64),
    Duplicate,
    /// Not a receipt we can read; the text says why.
    Unreadable(String),
}

/// Text of a file or attachment in an unknown encoding: UTF-8, or else Latin-1 (older shop
/// systems and some mail clients).
pub fn decode_text(data: &[u8]) -> String {
    match std::str::from_utf8(data) {
        Ok(s) => s.to_string(),
        Err(_) => data.iter().map(|b| char::from(*b)).collect(),
    }
}

pub struct Documents;

impl Documents {
    /// Read and store a document that was handed over as a receipt.
    pub async fn import(
        store: &Store,
        source: SourceKind,
        kind: DocKind,
        data: Vec<u8>,
        hint: Option<&str>,
        fallback_date: Option<Date>,
    ) -> Result<DocResult, SyncError> {
        let text = match kind {
            DocKind::Pdf => match pdf_to_text(data).await {
                Ok(t) => t,
                Err(e) => return Ok(DocResult::Unreadable(e.to_string())),
            },
            DocKind::Html => html_to_text(&decode_text(&data)),
            DocKind::Text => decode_text(&data),
        };
        Self::import_text(store, source, &text, hint, fallback_date, Trust::Document).await
    }

    /// Read and store receipt text.
    pub async fn import_text(
        store: &Store,
        source: SourceKind,
        text: &str,
        hint: Option<&str>,
        fallback_date: Option<Date>,
        trust: Trust,
    ) -> Result<DocResult, SyncError> {
        match ReceiptReader::read(text, hint, fallback_date, trust) {
            Err(e) => Ok(DocResult::Unreadable(e.to_string())),
            Ok(r) => Ok(match Ingest::store(store, source, &r).await? {
                Stored::New(id) => DocResult::Imported(id),
                Stored::Duplicate => DocResult::Duplicate,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::fixtures::REWE_EBON;
    use crate::testing::rewe_ebon_pdf;

    #[test]
    fn latin1_fallback() {
        assert_eq!(decode_text("Käse".as_bytes()), "Käse");
        assert_eq!(decode_text(&[b'K', 0xe4, b's', b'e']), "Käse");
    }

    #[tokio::test]
    async fn a_pdf_with_a_text_layer_is_read() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        let res = Documents::import(
            &store,
            SourceKind::Folder,
            DocKind::Pdf,
            rewe_ebon_pdf(),
            Some("rewe"),
            None,
        )
        .await
        .unwrap();
        assert!(matches!(res, DocResult::Imported(_)), "{res:?}");
        let metas = store.receipt_metas().await.unwrap();
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].total_cents, Some(784));
        assert_eq!(metas[0].time.as_deref(), Some("18:42"));
        // the text twin of the same eBon is the same purchase
        let again = Documents::import(
            &store,
            SourceKind::Email,
            DocKind::Text,
            REWE_EBON.as_bytes().to_vec(),
            Some("rewe"),
            None,
        )
        .await
        .unwrap();
        assert_eq!(again, DocResult::Duplicate);
    }

    #[tokio::test]
    async fn unreadable_documents_are_reported_not_fatal() {
        let store = Store::connect("sqlite::memory:").await.unwrap();
        for (kind, data) in [
            (DocKind::Pdf, b"junk".to_vec()),
            (DocKind::Html, b"<p>Hallo</p>".to_vec()),
            (DocKind::Text, Vec::new()),
        ] {
            let r = Documents::import(&store, SourceKind::Folder, kind, data, None, None)
                .await
                .unwrap();
            assert!(matches!(r, DocResult::Unreadable(_)), "{kind:?}");
        }
        assert!(store.receipt_metas().await.unwrap().is_empty());
    }
}
