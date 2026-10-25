//! The server's settings file: what was set from the app, kept next to the database.
//!
//! It is plain JSON (`financer.settings.json`), written atomically and readable by the server's
//! user only, like `financer.toml` is advised to be. Besides the values it remembers an update
//! that has not proved itself yet: the server restarts to apply a change, and when the changed
//! settings do not start, the previous ones come back by themselves, so a typo in the app can
//! never lock you out of the server.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Env, Overlay};

/// File name used when `FINANCER_SETTINGS_FILE` does not say otherwise.
pub const SETTINGS_FILE_NAME: &str = "financer.settings.json";

/// How many starts a changed configuration gets before the previous one comes back. A start that
/// ends with an error rolls back at once; this only bounds the case where the process dies
/// without saying why.
pub const MAX_START_ATTEMPTS: u32 = 2;

const VERSION: u32 = 1;

/// A change that was written but has not started successfully yet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pending {
    /// The values that were in force before the change.
    pub previous: BTreeMap<String, Value>,
    pub attempts: u32,
    /// Unix seconds.
    pub at: i64,
}

/// Why the last change was undone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LastError {
    pub message: String,
    pub at: i64,
}

/// The content of the file.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Stored {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub values: BTreeMap<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<Pending>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<LastError>,
}

impl Stored {
    /// Undo the pending change.
    fn roll_back(&mut self, message: &str) {
        if let Some(p) = self.pending.take() {
            self.values = p.previous;
            self.last_error = Some(LastError {
                message: message.to_string(),
                at: now(),
            });
        }
    }
}

pub(crate) fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// What the server learns when it starts.
#[derive(Debug, Clone, Default)]
pub struct Begin {
    /// The values to run with.
    pub overlay: Overlay,
    /// These values are a change that has not proved itself yet.
    pub applying: bool,
    /// The previous settings were put back because the changed ones kept failing.
    pub rolled_back: bool,
    /// Things worth telling the operator.
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct SettingsFile {
    path: PathBuf,
}

impl SettingsFile {
    pub fn at(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// Where the file belongs: `FINANCER_SETTINGS_FILE`, else next to the SQLite database (that
    /// folder is the one that is kept, a Docker volume say), else the working directory.
    pub fn locate(env: &dyn Env, database_url: &str, cwd: &Path) -> Self {
        if let Some(p) = env.nonempty("FINANCER_SETTINGS_FILE") {
            return Self::at(cwd.join(p.trim()));
        }
        let dir = Self::sqlite_path(database_url)
            .and_then(|db| db.parent().map(Path::to_path_buf))
            .filter(|d| !d.as_os_str().is_empty())
            .map(|d| cwd.join(d))
            .unwrap_or_else(|| cwd.to_path_buf());
        Self::at(dir.join(SETTINGS_FILE_NAME))
    }

    /// The database file of a `sqlite:` address.
    fn sqlite_path(url: &str) -> Option<PathBuf> {
        let rest = url
            .strip_prefix("sqlite://")
            .or_else(|| url.strip_prefix("sqlite:"))?;
        let rest = rest.split('?').next().unwrap_or("");
        if rest.is_empty() || rest.starts_with(":memory:") {
            None
        } else {
            Some(PathBuf::from(rest))
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Whether a change could be saved: the folder exists and the file (if there is one) can be
    /// written.
    pub fn writable(&self) -> bool {
        let dir = self.path.parent().filter(|d| !d.as_os_str().is_empty());
        let dir = dir.unwrap_or_else(|| Path::new("."));
        let dir_ok = std::fs::metadata(dir)
            .map(|m| m.is_dir() && !m.permissions().readonly())
            .unwrap_or(false);
        let file_ok = match std::fs::metadata(&self.path) {
            Ok(m) => !m.permissions().readonly(),
            Err(_) => true,
        };
        dir_ok && file_ok
    }

    /// The content; a missing or empty file is an empty one.
    pub fn read(&self) -> Result<Stored, String> {
        let text = match std::fs::read_to_string(&self.path) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Stored::default()),
            Err(e) => return Err(format!("cannot read {}: {e}", self.path.display())),
        };
        if text.trim().is_empty() {
            return Ok(Stored::default());
        }
        serde_json::from_str(&text)
            .map_err(|e| format!("{} is not valid JSON: {e}", self.path.display()))
    }

    /// Replace the file atomically, readable by the server's user only.
    pub fn write(&self, stored: &Stored) -> Result<(), String> {
        let mut stored = stored.clone();
        stored.version = VERSION;
        let text = serde_json::to_string_pretty(&stored).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        let fail = |what: &str, e: std::io::Error| {
            format!(
                "cannot {what} {}: {e}. Set FINANCER_SETTINGS_FILE to a path the server may write (the folder of your database is a good place)",
                self.path.display()
            )
        };
        {
            use std::io::Write;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut f = options.open(&tmp).map_err(|e| fail("write", e))?;
            f.write_all(text.as_bytes()).map_err(|e| fail("write", e))?;
            f.sync_all().map_err(|e| fail("write", e))?;
        }
        std::fs::rename(&tmp, &self.path).map_err(|e| fail("replace", e))
    }

    /// The values now in the file, without touching it (for `--print-config` and the like).
    pub fn overlay(&self) -> Overlay {
        Overlay::new(self.read().map(|s| s.values).unwrap_or_default())
    }

    /// First thing a starting server does: which values to run with. A change that already failed
    /// to start [`MAX_START_ATTEMPTS`] times is undone here.
    pub fn begin(&self) -> Begin {
        let mut warnings = Vec::new();
        let mut stored = match self.read() {
            Ok(s) => s,
            Err(e) => {
                // keep the broken file for inspection instead of overwriting it later
                let broken = self.path.with_extension("json.broken");
                let _ = std::fs::rename(&self.path, &broken);
                warnings.push(format!(
                    "{e}; the settings from the app are ignored (the file was moved to {})",
                    broken.display()
                ));
                Stored::default()
            }
        };
        let mut rolled_back = false;
        let mut dirty = false;
        match stored.pending.as_mut() {
            Some(p) if p.attempts >= MAX_START_ATTEMPTS => {
                stored
                    .roll_back("the changed settings did not start, so the previous ones are back");
                rolled_back = true;
                dirty = true;
            }
            Some(p) => {
                p.attempts += 1;
                dirty = true;
            }
            None => {}
        }
        if dirty {
            if let Err(e) = self.write(&stored) {
                warnings.push(e);
            }
        }
        if rolled_back {
            warnings.push(
                "the last change from the app did not start; the previous settings are back"
                    .to_string(),
            );
        }
        Begin {
            overlay: Overlay::new(stored.values.clone()),
            applying: stored.pending.is_some(),
            rolled_back,
            warnings,
        }
    }

    /// The server is up with the changed settings: they stay.
    pub fn confirm(&self) {
        if let Ok(mut stored) = self.read() {
            if stored.pending.take().is_some() {
                let _ = self.write(&stored);
            }
        }
    }

    /// The server could not start with a changed configuration. Puts the previous values back
    /// and says whether it did (the caller then starts again).
    pub fn fail(&self, message: &str) -> bool {
        let Ok(mut stored) = self.read() else {
            return false;
        };
        if stored.pending.is_none() {
            return false;
        }
        stored.roll_back(&format!("the changed settings did not start: {message}"));
        self.write(&stored).is_ok()
    }
}
