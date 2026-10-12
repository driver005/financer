//! Where prices come from and how they become comparable.

pub mod ean;
pub mod http;
pub mod jsonld;
pub mod normalize;
pub mod off;
pub mod pagetext;
pub mod rank;
pub mod size;
pub mod source;

pub use ean::{Ean, EanError, EanKind};
pub use http::{fake::FakeHttp, Http, HttpResponse, PoliteHttp, ReqwestHttp};
pub use normalize::{NormalizeReport, Normalizer, QuoteDetail, RawOffer, Skip};
pub use rank::{Basis, ChainRanker, Keys, Ranking};
pub use size::PackSize;
pub use source::{
    JsonLdSource, LlmPageSource, OpenPricesSource, PriceSource, RefreshResult, SourceConfig,
    SourceStatus, Sources,
};

#[derive(Debug, thiserror::Error)]
pub enum PriceError {
    #[error("HTTP error: {0}")]
    Http(String),
    /// robots.txt (or an unreachable robots.txt) says we must not fetch.
    #[error("not allowed to fetch: {0}")]
    Blocked(String),
}
