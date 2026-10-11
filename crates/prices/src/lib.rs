//! Where prices come from and how they become comparable.

pub mod http;
pub mod jsonld;
pub mod normalize;
pub mod off;
pub mod pagetext;
pub mod size;
pub mod source;

pub use http::{fake::FakeHttp, Http, HttpResponse, PoliteHttp, ReqwestHttp};
pub use normalize::{normalize, normalize_all, NormalizeReport, QuoteDetail, RawOffer, Skip};
pub use source::{
    build_sources, refresh, JsonLdSource, LlmPageSource, OpenPricesSource, PriceSource,
    RefreshResult, SourceConfig, SourceStatus,
};

#[derive(Debug, thiserror::Error)]
pub enum PriceError {
    #[error("HTTP error: {0}")]
    Http(String),
    /// robots.txt (or an unreachable robots.txt) says we must not fetch.
    #[error("not allowed to fetch: {0}")]
    Blocked(String),
}
