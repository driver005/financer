//! Every constant of the (unofficial) Lidl Plus protocol, in one place.
//!
//! Source: the public open-source client by Andre0512,
//! <https://github.com/Andre0512/lidl-plus> (`lidlplus/api.py`), which reverse-engineered how the
//! Lidl Plus app signs in and reads receipts. Nothing is copied from it; the values below are
//! facts about the protocol as that project documents them, and the flow is reimplemented here.
//! They are not an official interface, are not verified by this project against a live account,
//! and may change at any time; each can be overridden under `[receipts.lidl_plus]`.

/// OAuth client id of the Lidl Plus app (`_CLIENT_ID` in the open-source client).
pub const CLIENT_ID: &str = "LidlPlusNativeClient";

/// The app is a public client; it authenticates the token endpoint with this fixed, non-secret
/// value (`Basic base64("LidlPlusNativeClient:secret")` in the open-source client).
pub const CLIENT_SECRET: &str = "secret";

/// Identity provider (`_AUTH_API`).
pub const AUTH_BASE: &str = "https://accounts.lidl.com";

/// Where the sign-in page lives. The open-source client reads this from the provider's OpenID
/// discovery document; `/connect/authorize` is the standard path of the identity server Lidl uses
/// (its token endpoint is `/connect/token`), so discovery is skipped. If sign-in fails with a
/// "not found" page on Lidl's side, this is the first thing to override.
pub const AUTHORIZE_PATH: &str = "/connect/authorize";

/// Token endpoint path (`/connect/token` in the open-source client).
pub const TOKEN_PATH: &str = "/connect/token";

/// Receipt ("ticket") API (`_TICKET_API`); `/{COUNTRY}/tickets` is appended.
pub const TICKETS_BASE: &str = "https://tickets.lidlplus.com/api/v2";

/// Redirect target registered for the app (`{_APP}://callback`). Lidl's page sends the browser
/// there after sign-in; the address carries the one-time `code`.
pub const REDIRECT_URI: &str = "com.lidlplus.app://callback";

/// The scheme part of [`REDIRECT_URI`], which the mobile app watches for.
pub const CALLBACK_SCHEME: &str = "com.lidlplus.app";

/// Requested scopes; `offline_access` is what yields a refresh token.
pub const SCOPE: &str = "openid profile offline_access lpprofile lpapis";

/// Headers the ticket API expects (`_default_headers` in the open-source client).
pub const APP_VERSION_HEADER: &str = "999.99.9";
pub const OPERATING_SYSTEM_HEADER: &str = "iOs";
pub const APP_HEADER: &str = "com.lidl.eci.lidl.plus";

/// Seconds a started sign-in stays valid before `finish` is refused.
pub const SIGN_IN_TTL_SECS: u64 = 15 * 60;
