//! Encryption at rest for the few secrets the server keeps (the Lidl Plus refresh token).
//!
//! The key is derived (HKDF-SHA256) from a server secret that is not in the database: the
//! `FINANCER_SECRET_KEY` variable, or else the API token. Every sealed value gets its own random
//! salt and nonce, is encrypted with XChaCha20-Poly1305, and is bound to its purpose, so a value
//! sealed for one use cannot be opened for another. A stolen database file, or a backup of it,
//! reveals nothing without the server secret; changing the secret makes old values unreadable,
//! which shows up as "sign in again", never as a wrong value.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroizing;

const VERSION: &str = "v1";
const INFO_PREFIX: &str = "financer/receipt-sources/v1/";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
/// Shortest server secret accepted.
pub const MIN_SECRET_LEN: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SecretError {
    #[error("the server secret is too short (at least {MIN_SECRET_LEN} characters)")]
    WeakSecret,
    #[error("the stored value cannot be opened with this server secret")]
    Cannot,
}

/// Seals and opens values with a key derived from the server secret.
#[derive(Clone)]
pub struct SecretBox {
    ikm: Zeroizing<Vec<u8>>,
}

impl std::fmt::Debug for SecretBox {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretBox(<redacted>)")
    }
}

impl SecretBox {
    pub fn new(server_secret: &str) -> Result<Self, SecretError> {
        if server_secret.len() < MIN_SECRET_LEN {
            return Err(SecretError::WeakSecret);
        }
        Ok(SecretBox {
            ikm: Zeroizing::new(server_secret.as_bytes().to_vec()),
        })
    }

    fn cipher(&self, salt: &[u8], purpose: &str) -> XChaCha20Poly1305 {
        let hk = Hkdf::<Sha256>::new(Some(salt), &self.ikm);
        let mut key = Zeroizing::new([0u8; 32]);
        hk.expand(format!("{INFO_PREFIX}{purpose}").as_bytes(), key.as_mut())
            .expect("32 bytes is a valid HKDF output length");
        XChaCha20Poly1305::new((&*key).into())
    }

    /// `v1.<salt>.<nonce>.<ciphertext>`, URL-safe base64, safe to store as text.
    pub fn seal(&self, purpose: &str, plaintext: &str) -> Result<String, SecretError> {
        let mut salt = [0u8; SALT_LEN];
        let mut nonce = [0u8; NONCE_LEN];
        getrandom::fill(&mut salt).map_err(|_| SecretError::Cannot)?;
        getrandom::fill(&mut nonce).map_err(|_| SecretError::Cannot)?;
        let ct = self
            .cipher(&salt, purpose)
            .encrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: plaintext.as_bytes(),
                    aad: purpose.as_bytes(),
                },
            )
            .map_err(|_| SecretError::Cannot)?;
        Ok(format!(
            "{VERSION}.{}.{}.{}",
            URL_SAFE_NO_PAD.encode(salt),
            URL_SAFE_NO_PAD.encode(nonce),
            URL_SAFE_NO_PAD.encode(ct)
        ))
    }

    pub fn open(&self, purpose: &str, sealed: &str) -> Result<Zeroizing<String>, SecretError> {
        let mut parts = sealed.split('.');
        let (Some(VERSION), Some(salt), Some(nonce), Some(ct), None) = (
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
            parts.next(),
        ) else {
            return Err(SecretError::Cannot);
        };
        let dec = |s: &str| URL_SAFE_NO_PAD.decode(s).map_err(|_| SecretError::Cannot);
        let (salt, nonce, ct) = (dec(salt)?, dec(nonce)?, dec(ct)?);
        let nonce =
            <[u8; NONCE_LEN]>::try_from(nonce.as_slice()).map_err(|_| SecretError::Cannot)?;
        if salt.len() != SALT_LEN {
            return Err(SecretError::Cannot);
        }
        let plain = self
            .cipher(&salt, purpose)
            .decrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: &ct,
                    aad: purpose.as_bytes(),
                },
            )
            .map_err(|_| SecretError::Cannot)?;
        String::from_utf8(plain)
            .map(Zeroizing::new)
            .map_err(|_| SecretError::Cannot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn roundtrip_and_every_seal_differs() {
        let b = SecretBox::new(KEY).unwrap();
        let a = b.seal("lidl", "refresh-token-123").unwrap();
        let c = b.seal("lidl", "refresh-token-123").unwrap();
        assert_ne!(a, c, "fresh salt and nonce each time");
        assert!(!a.contains("refresh-token-123"));
        assert_eq!(b.open("lidl", &a).unwrap().as_str(), "refresh-token-123");
        assert_eq!(b.open("lidl", &c).unwrap().as_str(), "refresh-token-123");
    }

    #[test]
    fn wrong_key_purpose_or_tampering_fails() {
        let b = SecretBox::new(KEY).unwrap();
        let sealed = b.seal("lidl", "t").unwrap();
        let other = SecretBox::new("another-server-secret-value-xyz").unwrap();
        assert_eq!(
            other.open("lidl", &sealed).unwrap_err(),
            SecretError::Cannot
        );
        assert_eq!(b.open("email", &sealed).unwrap_err(), SecretError::Cannot);
        let mut bytes = sealed.clone().into_bytes();
        let last = bytes.len() - 2;
        bytes[last] = if bytes[last] == b'A' { b'B' } else { b'A' };
        assert!(b
            .open("lidl", std::str::from_utf8(&bytes).unwrap())
            .is_err());
        for junk in ["", "v1", "v2.a.b.c", "v1.a.b", "v1.a.b.c.d", "plain-token"] {
            assert!(b.open("lidl", junk).is_err(), "{junk}");
        }
    }

    #[test]
    fn short_secrets_are_refused_and_debug_hides_the_key() {
        assert_eq!(
            SecretBox::new("short").unwrap_err(),
            SecretError::WeakSecret
        );
        let b = SecretBox::new(KEY).unwrap();
        assert!(!format!("{b:?}").contains("0123"));
    }
}
