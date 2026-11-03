//! A typed client for the Financer server, in Rust, for every place that talks to it: the app
//! (through UniFFI bindings, natively and in the browser as WebAssembly), tests, and other tools.
//!
//! The request and response types are the server's own, so a change to the API that this client
//! does not follow does not compile. Where a call goes is a [`transport::Transport`]: the network
//! ([`transport::HttpTransport`]) or, on the phone that runs the backend inside the app, the server's
//! router in the same process.
//!
//! So far: the mail API ([`mail::MailSdk`]). See docs/SDK.md for what follows.

pub mod error;
pub mod mail;
pub mod transport;

pub use error::SdkError;
pub use mail::MailSdk;
#[cfg(feature = "http")]
pub use transport::HttpTransport;
pub use transport::{Request, Response, Transport};

uniffi::setup_scaffolding!();

// The browser player needs this module linked in; nothing refers to it, so the linker would drop it.
#[cfg(target_arch = "wasm32")]
extern crate uniffi_runtime_wasm as _;
