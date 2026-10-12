//! Passphrase-encrypted backups. The plaintext is the JSON export (see `export.rs`); it is
//! encrypted with the `age` format (scrypt passphrase recipient, ChaCha20-Poly1305), so a backup
//! file can also be opened with the standard `age` tool: `age -d backup.age`.
//!
//! The app transport only carries text, so the encrypted bytes travel as base64 inside JSON.
//! The passphrase is only ever used in memory: it is never stored, logged or echoed back.

use std::fmt;
use std::io::Read;

use age::secrecy::SecretString;
use axum::extract::State;
use axum::Json;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::dto::{ErrorBody, ExportDto, ImportReportDto};
use crate::export::ExportRoutes;
use crate::routes::ApiError;
use crate::AppState;

/// scrypt cost used when creating a backup: N = 2^17 (about 128 MiB of memory, a fraction of a
/// second on a current phone). It is stored in the file, so it can change later.
const CREATE_LOG_N: u8 = 17;
/// Highest cost accepted when opening a file, so a hostile file cannot make us use unbounded
/// memory or time. Covers files made by the `age` tool with its default (18).
const MAX_LOG_N: u8 = 20;
const MIN_PASSPHRASE_CHARS: usize = 8;
const MAX_PASSPHRASE_BYTES: usize = 1024;
/// Largest backup accepted (encrypted bytes); the request body limit is 10 MB anyway.
const MAX_BACKUP_BYTES: usize = 7 * 1024 * 1024;
const WRONG_OR_DAMAGED: &str = "Wrong passphrase, or this is not an intact Financer backup.";

#[derive(Deserialize, ToSchema)]
pub struct BackupCreateRequest {
    /// At least 8 characters. Not stored anywhere: without it the backup cannot be opened.
    pub passphrase: String,
}

impl fmt::Debug for BackupCreateRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BackupCreateRequest")
            .field("passphrase", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct BackupDto {
    /// The encrypted backup (an `age` file), base64-encoded.
    pub data_base64: String,
    pub transactions: usize,
    pub receipts: usize,
}

#[derive(Deserialize, ToSchema)]
pub struct BackupRestoreRequest {
    pub passphrase: String,
    /// The encrypted backup, base64-encoded, as returned by the create endpoint.
    pub data_base64: String,
}

impl fmt::Debug for BackupRestoreRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BackupRestoreRequest")
            .field("passphrase", &"<redacted>")
            .field("data_base64_len", &self.data_base64.len())
            .finish()
    }
}

/// Why a backup could not be made or opened. Wrong passphrase and damaged data are deliberately
/// one error: the format cannot tell them apart, and telling an attacker more helps nobody.
#[derive(Debug, PartialEq, Eq)]
pub enum BackupError {
    Encrypt,
    WrongPassphraseOrDamaged,
}

/// The cryptography, without HTTP or the store, so it is easy to test.
pub struct BackupCrypto;

impl BackupCrypto {
    /// Encrypt `plaintext` with `passphrase` (scrypt work factor `log_n`).
    pub fn seal(plaintext: &[u8], passphrase: &str, log_n: u8) -> Result<Vec<u8>, BackupError> {
        let mut recipient = age::scrypt::Recipient::new(SecretString::from(passphrase.to_owned()));
        recipient.set_work_factor(log_n);
        age::encrypt(&recipient, plaintext).map_err(|_| BackupError::Encrypt)
    }

    /// Decrypt a file made by [`Self::seal`]. At most `max_plain` bytes of plaintext are produced.
    pub fn open(data: &[u8], passphrase: &str, max_plain: usize) -> Result<Vec<u8>, BackupError> {
        let mut identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_owned()));
        identity.set_max_work_factor(MAX_LOG_N);
        let decryptor = age::Decryptor::new_buffered(data)
            .map_err(|_| BackupError::WrongPassphraseOrDamaged)?;
        let mut reader = decryptor
            .decrypt(std::iter::once(&identity as &dyn age::Identity))
            .map_err(|_| BackupError::WrongPassphraseOrDamaged)?;
        let mut out = Vec::new();
        // reading fails on any corrupted or truncated chunk (each one is authenticated)
        (&mut reader)
            .take(max_plain as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|_| BackupError::WrongPassphraseOrDamaged)?;
        if out.len() > max_plain {
            return Err(BackupError::WrongPassphraseOrDamaged);
        }
        Ok(out)
    }
}

/// Handlers' real logic; the free functions below are thin shims because `#[utoipa::path]`
/// cannot annotate methods.
pub struct BackupRoutes;

/// Create a passphrase-encrypted backup of everything that is yours (see `/v1/export`).
#[utoipa::path(post, path = "/v1/backup/create", request_body = BackupCreateRequest, responses(
    (status = 200, body = BackupDto),
    (status = 400, description = "Passphrase too short", body = ErrorBody)), security(("bearer" = [])))]
pub async fn create_backup(
    State(state): State<AppState>,
    Json(req): Json<BackupCreateRequest>,
) -> Result<Json<BackupDto>, ApiError> {
    BackupRoutes::create(state, req).await
}

/// Decrypt a backup and merge it like `/v1/import`. A wrong passphrase or damaged file is a
/// 400 and changes nothing.
#[utoipa::path(post, path = "/v1/backup/restore", request_body = BackupRestoreRequest, responses(
    (status = 200, body = ImportReportDto),
    (status = 400, description = "Wrong passphrase, damaged file or not a valid backup", body = ErrorBody)),
    security(("bearer" = [])))]
pub async fn restore_backup(
    State(state): State<AppState>,
    Json(req): Json<BackupRestoreRequest>,
) -> Result<Json<ImportReportDto>, ApiError> {
    BackupRoutes::restore(state, req).await
}

impl BackupRoutes {
    pub async fn create(
        state: AppState,
        req: BackupCreateRequest,
    ) -> Result<Json<BackupDto>, ApiError> {
        Self::check_passphrase(&req.passphrase)?;
        let export = ExportRoutes::export_data(state).await?.0;
        let (transactions, receipts) = (export.transactions.len(), export.receipts.len());
        let plain = serde_json::to_vec(&export).map_err(|_| ApiError::Internal)?;
        let passphrase = req.passphrase;
        // scrypt is deliberately slow: keep it off the async workers
        let sealed = tokio::task::spawn_blocking(move || {
            BackupCrypto::seal(&plain, &passphrase, CREATE_LOG_N)
        })
        .await
        .map_err(|_| ApiError::Internal)?
        .map_err(|_| ApiError::Internal)?;
        Ok(Json(BackupDto {
            data_base64: STANDARD.encode(sealed),
            transactions,
            receipts,
        }))
    }

    pub async fn restore(
        state: AppState,
        req: BackupRestoreRequest,
    ) -> Result<Json<ImportReportDto>, ApiError> {
        let wrong = || ApiError::BadRequest(WRONG_OR_DAMAGED.into());
        let b64 = req.data_base64.trim();
        if req.passphrase.len() > MAX_PASSPHRASE_BYTES || b64.is_empty() {
            return Err(wrong());
        }
        if b64.len() > MAX_BACKUP_BYTES / 3 * 4 + 8 {
            return Err(ApiError::BadRequest("backup is too large".into()));
        }
        let data = STANDARD.decode(b64).map_err(|_| wrong())?;
        let passphrase = req.passphrase;
        let plain = tokio::task::spawn_blocking(move || {
            BackupCrypto::open(&data, &passphrase, MAX_BACKUP_BYTES)
        })
        .await
        .map_err(|_| ApiError::Internal)?
        .map_err(|_| wrong())?;
        // authenticated, so it was made by someone who knew the passphrase; import still validates it
        let export: ExportDto = serde_json::from_slice(&plain).map_err(|_| wrong())?;
        ExportRoutes::import_data(state, export).await
    }

    fn check_passphrase(p: &str) -> Result<(), ApiError> {
        if p.chars().count() < MIN_PASSPHRASE_CHARS {
            return Err(ApiError::BadRequest(format!(
                "the passphrase needs at least {MIN_PASSPHRASE_CHARS} characters"
            )));
        }
        if p.len() > MAX_PASSPHRASE_BYTES {
            return Err(ApiError::BadRequest("the passphrase is too long".into()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // a low work factor keeps unit tests fast; the format stores it in the file
    const TEST_LOG_N: u8 = 8;

    #[test]
    fn round_trips() {
        let data = b"{\"version\":1}".repeat(10_000);
        let sealed = BackupCrypto::seal(&data, "correct horse", TEST_LOG_N).unwrap();
        assert!(!sealed.windows(7).any(|w| w == b"version"));
        assert_eq!(
            BackupCrypto::open(&sealed, "correct horse", usize::MAX / 2).unwrap(),
            data
        );
    }

    #[test]
    fn wrong_passphrase_fails_cleanly() {
        let sealed = BackupCrypto::seal(b"secret", "correct horse", TEST_LOG_N).unwrap();
        assert_eq!(
            BackupCrypto::open(&sealed, "correct horsf", 1000),
            Err(BackupError::WrongPassphraseOrDamaged)
        );
        assert_eq!(
            BackupCrypto::open(&sealed, "", 1000),
            Err(BackupError::WrongPassphraseOrDamaged)
        );
    }

    #[test]
    fn corrupted_or_truncated_data_fails_cleanly() {
        let data = vec![7u8; 200_000]; // several 64 KiB chunks
        let sealed = BackupCrypto::seal(&data, "correct horse", TEST_LOG_N).unwrap();
        for index in [0, 30, sealed.len() / 2, sealed.len() - 1] {
            let mut bad = sealed.clone();
            bad[index] ^= 0x01;
            assert_eq!(
                BackupCrypto::open(&bad, "correct horse", usize::MAX / 2),
                Err(BackupError::WrongPassphraseOrDamaged),
                "flipped byte {index}"
            );
        }
        for len in [0, 10, sealed.len() / 2, sealed.len() - 5] {
            assert_eq!(
                BackupCrypto::open(&sealed[..len], "correct horse", usize::MAX / 2),
                Err(BackupError::WrongPassphraseOrDamaged),
                "truncated to {len}"
            );
        }
        assert!(BackupCrypto::open(b"not an age file at all", "x", 100).is_err());
    }

    #[test]
    fn plaintext_over_the_limit_is_refused() {
        let sealed = BackupCrypto::seal(&[0u8; 5000], "correct horse", TEST_LOG_N).unwrap();
        assert!(BackupCrypto::open(&sealed, "correct horse", 4999).is_err());
        assert!(BackupCrypto::open(&sealed, "correct horse", 5000).is_ok());
    }

    #[test]
    fn debug_output_hides_the_passphrase() {
        let r = BackupCreateRequest {
            passphrase: "hunter2hunter2".into(),
        };
        assert!(!format!("{r:?}").contains("hunter2"));
        let r = BackupRestoreRequest {
            passphrase: "hunter2hunter2".into(),
            data_base64: "AAAA".into(),
        };
        assert!(!format!("{r:?}").contains("hunter2"));
    }
}
