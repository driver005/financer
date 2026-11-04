//! The app's own logic (formatting, periods, wording), called by name. It is plain Rust in
//! `financer-logic`; this is only the entry the apps reach it through. Synchronous: a screen asks for
//! a label while it draws.

use crate::error::SdkError;

/// The function `module.name` (e.g. `format.format_cents`) with its arguments as a JSON object; the
/// answer as JSON text.
#[uniffi::export]
pub fn logic(name: String, args: String) -> Result<String, SdkError> {
    financer_logic::call(&name, &args).map_err(|message| SdkError::Decode { message })
}
