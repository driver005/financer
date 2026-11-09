#include "s3.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <ctime>

namespace nc::cloud::s3 {

namespace {

    std::string xml_unescape(std::string_view text)
    {
        std::string out;
        for (std::size_t at = 0; at < text.size(); ++at) {
            if (text[at] == '&') {
                for (const auto& [entity, letter]:
                     {std::pair<std::string_view, char>{"&amp;", '&'},
                      {"&lt;", '<'},
                      {"&gt;", '>'},
                      {"&quot;", '"'},
                      {"&apos;", '\''}}) {
                    if (text.substr(at, entity.size()) == entity) {
                        out += letter;
                        at += entity.size() - 1;
                        goto next;
                    }
                }
            }
            out += text[at];
        next:;
        }
        return out;
    }

    /// The text of the first `<name>` element at or after `from`; `end` receives the position after
    /// it.
    std::string
    element(std::string_view xml, std::string_view name, std::size_t from, std::size_t& end)
    {
        const std::string open = "<" + std::string{name} + ">";
        const std::size_t begin = xml.find(open, from);
        if (begin == std::string_view::npos) {
            end = std::string_view::npos;
            return {};
        }
        const std::size_t close = xml.find("</" + std::string{name} + ">", begin);
        if (close == std::string_view::npos) {
            end = std::string_view::npos;
            return {};
        }
        end = close + name.size() + 3;
        return xml_unescape(xml.substr(begin + open.size(), close - begin - open.size()));
    }

    std::int64_t parse_iso(const std::string& text)
    {
        std::tm moment{};
        if (strptime(text.c_str(), "%Y-%m-%dT%H:%M:%S", &moment) == nullptr) {
            return 0;
        }
        return static_cast<std::int64_t>(timegm(&moment));
    }

} // namespace

std::string encode(std::string_view text, bool keep_slash)
{
    static constexpr char HEX[] = "0123456789ABCDEF";
    std::string out;
    for (const char letter: text) {
        const auto byte = static_cast<unsigned char>(letter);
        const bool plain = (byte >= 'A' && byte <= 'Z') || (byte >= 'a' && byte <= 'z') ||
                           (byte >= '0' && byte <= '9') || byte == '-' || byte == '_' ||
                           byte == '.' || byte == '~' || (keep_slash && byte == '/');
        if (plain) {
            out += letter;
        } else {
            out += '%';
            out += HEX[byte >> 4U];
            out += HEX[byte & 0xFU];
        }
    }
    return out;
}

std::string amz_date(std::int64_t unix_seconds)
{
    const auto raw = static_cast<std::time_t>(unix_seconds);
    std::tm parts{};
    gmtime_r(&raw, &parts);
    char buffer[32];
    const std::size_t written = std::strftime(buffer, sizeof(buffer), "%Y%m%dT%H%M%SZ", &parts);
    return std::string(buffer, written);
}

std::vector<nc::http::Header> sign(
    const Credentials& credentials,
    std::string_view method,
    std::string_view host,
    std::string_view canonical_uri,
    std::string_view canonical_query,
    const std::vector<nc::http::Header>& extra,
    std::string_view body,
    std::string_view date
)
{
    const std::string payload = util::to_hex(util::sha256(body));
    // The signed headers, sorted by name.
    std::vector<nc::http::Header> signed_headers{
        {"host", std::string{host}},
        {"x-amz-content-sha256", payload},
        {"x-amz-date", std::string{date}}
    };
    for (const nc::http::Header& header: extra) {
        signed_headers.emplace_back(
            util::to_lower(header.first),
            std::string{util::trim(header.second)}
        );
    }
    std::ranges::sort(
        signed_headers,
        [](const nc::http::Header& left, const nc::http::Header& right)
        {
            return left.first < right.first;
        }
    );
    std::string canonical_headers;
    std::string names;
    for (const nc::http::Header& header: signed_headers) {
        canonical_headers += header.first + ":" + header.second + "\n";
        names += (names.empty() ? "" : ";") + header.first;
    }
    const std::string canonical = std::string{method} + "\n" + std::string{canonical_uri} + "\n" +
                                  std::string{canonical_query} + "\n" + canonical_headers + "\n" +
                                  names + "\n" + payload;
    const std::string day{date.substr(0, 8)};
    const std::string scope = day + "/" + credentials.region + "/s3/aws4_request";
    const std::string to_sign = "AWS4-HMAC-SHA256\n" + std::string{date} + "\n" + scope + "\n" +
                                util::to_hex(util::sha256(canonical));
    std::string key = util::hmac_sha256("AWS4" + credentials.secret_key, day);
    key = util::hmac_sha256(key, credentials.region);
    key = util::hmac_sha256(key, "s3");
    key = util::hmac_sha256(key, "aws4_request");
    const std::string signature = util::to_hex(util::hmac_sha256(key, to_sign));
    return {
        {"x-amz-date", std::string{date}},
        {"x-amz-content-sha256", payload},
        {"Authorization",
         "AWS4-HMAC-SHA256 Credential=" + credentials.access_key + "/" + scope +
             ", SignedHeaders=" + names + ", Signature=" + signature}
    };
}

Listing parse_listing(std::string_view xml)
{
    Listing listing;
    if (xml.find("<ListBucketResult") == std::string_view::npos) {
        return listing;
    }
    listing.valid = true;
    std::size_t at = 0;
    while (true) {
        const std::size_t block = xml.find("<Contents>", at);
        if (block == std::string_view::npos) {
            break;
        }
        const std::size_t close = xml.find("</Contents>", block);
        if (close == std::string_view::npos) {
            break;
        }
        const std::string_view part = xml.substr(block, close - block);
        std::size_t end = 0;
        Entry entry;
        entry.key = element(part, "Key", 0, end);
        entry.size = std::strtoull(element(part, "Size", 0, end).c_str(), nullptr, 10);
        entry.modified = parse_iso(element(part, "LastModified", 0, end));
        entry.etag = element(part, "ETag", 0, end);
        if (!entry.key.empty()) {
            listing.files.push_back(std::move(entry));
        }
        at = close + 11;
    }
    at = 0;
    while (true) {
        const std::size_t block = xml.find("<CommonPrefixes>", at);
        if (block == std::string_view::npos) {
            break;
        }
        const std::size_t close = xml.find("</CommonPrefixes>", block);
        if (close == std::string_view::npos) {
            break;
        }
        std::size_t end = 0;
        std::string prefix = element(xml.substr(block, close - block), "Prefix", 0, end);
        if (!prefix.empty()) {
            listing.folders.push_back(std::move(prefix));
        }
        at = close + 17;
    }
    std::size_t end = 0;
    listing.truncated = element(xml, "IsTruncated", 0, end) == "true";
    listing.next_token = element(xml, "NextContinuationToken", 0, end);
    return listing;
}

} // namespace nc::cloud::s3
