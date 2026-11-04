//! Every constant of the (unofficial) Kaufland Card protocol, in one place.
//!
//! Source: the public open-source project Bonfire (`Naxter/bonfire`, pull request 26, file
//! `backend/app/kaufland.py`), which signs in the way the Kaufland app does and reads the digital
//! receipts ("Digitale Kassenbons") of a Kaufland Card. Nothing is copied from it; the values
//! below are facts about the protocol as that project documents them, and the flow is
//! reimplemented here. They are not an official interface, were not checked by this project
//! against a live account, and may change at any time (the host of the receipts is also said to
//! be certificate-pinned for the real app). Each can be overridden under `[receipts.kaufland]`.

/// Identity provider (Cidaas) of the Kaufland account.
pub const AUTH_BASE: &str = "https://account.kaufland.com";
pub const AUTHORIZE_PATH: &str = "/authz-srv/authz";
pub const TOKEN_PATH: &str = "/token-srv/token";
pub const USERINFO_PATH: &str = "/users-srv/userinfo";

/// OAuth client id of the Kaufland app.
pub const CLIENT_ID: &str = "fb1b425b-ab2f-4140-aef9-20263b6cfa49";

/// The client id the receipt API expects in its `client-id` header (the loyalty programme's).
pub const LOYALTY_CLIENT_ID: &str = "88207bfc-780b-400d-92ee-893ae72dab40";

/// Where the digital receipts are served; `/api/v2/customers/{user}/transactions` is appended.
pub const API_BASE: &str = "https://p.crm-dynamics.schwarz";

/// Redirect target registered for the app. The browser is sent there after sign-in; the address
/// carries the one-time `code`.
pub const REDIRECT_URI: &str = "com.kaufland.kaufland://oauth/callback";

/// The scheme part of [`REDIRECT_URI`], which the mobile app watches for.
pub const CALLBACK_SCHEME: &str = "com.kaufland.kaufland";

/// The `v` parameter of the identity server's requests (its API version).
pub const OAUTH_VERSION: &str = "1.5.22";

/// Headers the receipt API expects from the app.
pub const APP_PLATFORM: &str = "Android";
pub const APP_VERSION: &str = "6.17.1";

/// Receipts asked for per page.
pub const PAGE_SIZE: usize = 20;

/// Seconds a started sign-in stays valid before `finish` is refused.
pub const SIGN_IN_TTL_SECS: u64 = 15 * 60;
