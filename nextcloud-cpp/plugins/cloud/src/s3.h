#pragma once

#include "nextcloud/http.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

/// Just enough of the S3 protocol for an external storage: AWS Signature Version 4 for requests,
/// and the entries of a `ListObjectsV2` answer.
namespace nc::cloud::s3 {

struct Credentials
{
    std::string access_key{};
    std::string secret_key{};
    std::string region{"us-east-1"};
};

/// @brief Percent-encodes everything but A-Z a-z 0-9 `-_.~` (and `/` when `keep_slash`).
[[nodiscard]] std::string encode(std::string_view text, bool keep_slash);

/// @brief `YYYYMMDDTHHMMSSZ` for a point in time.
[[nodiscard]] std::string amz_date(std::int64_t unix_seconds);

/// @brief The headers that make a request valid: `x-amz-date`, `x-amz-content-sha256` and
/// `Authorization`. `canonical_uri` and `canonical_query` are already encoded (query pairs sorted);
/// `extra` are further headers that are signed too (names lower case).
[[nodiscard]] std::vector<nc::http::Header> sign(
    const Credentials& credentials,
    std::string_view method,
    std::string_view host,
    std::string_view canonical_uri,
    std::string_view canonical_query,
    const std::vector<nc::http::Header>& extra,
    std::string_view body,
    std::string_view date
);

struct Entry
{
    std::string key{};
    std::uint64_t size{0};
    std::int64_t modified{0};
    std::string etag{};
};

struct Listing
{
    bool valid{false};
    std::vector<Entry> files{};
    std::vector<std::string> folders{}; // common prefixes, with the trailing slash
    bool truncated{false};
    std::string next_token{};
};

/// @brief Reads a `ListObjectsV2` answer.
[[nodiscard]] Listing parse_listing(std::string_view xml);

} // namespace nc::cloud::s3
