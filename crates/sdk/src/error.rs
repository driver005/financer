//! What can go wrong when talking to the server, in the three ways it can.

/// An error from a call. `Api` is the server saying no (with its reasons), `Network` is not reaching
/// it, `Decode` is an answer this SDK cannot read (a server of another version).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, uniffi::Error)]
pub enum SdkError {
    #[error("{message}")]
    Api {
        status: u16,
        message: String,
        /// One entry per thing to fix when the server refused a template, a recipient or a form.
        problems: Vec<String>,
    },
    #[error("cannot reach the server: {message}")]
    Network { message: String },
    #[error("the server's answer was not understood: {message}")]
    Decode { message: String },
}

impl SdkError {
    /// The error for a response that is not a success: the server's own words when it sent them,
    /// else words for the common statuses.
    pub fn from_response(status: u16, body: &[u8]) -> SdkError {
        use financer_mail_core::wire::ErrorBody;
        if let Ok(e) = serde_json::from_slice::<ErrorBody>(body) {
            return SdkError::Api {
                status,
                message: e.error,
                problems: e.problems,
            };
        }
        let text = String::from_utf8_lossy(body);
        let message = match status {
            401 => "The server did not accept the token.".to_string(),
            404 => "This server does not have that. It may be an older build, or built without this app.".to_string(),
            _ if !text.is_empty() && text.len() < 200 => text.to_string(),
            _ => format!("request failed ({status})"),
        };
        SdkError::Api {
            status,
            message,
            problems: Vec::new(),
        }
    }
}
