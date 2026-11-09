#pragma once

#include "nextcloud/util/expected.h"

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

/// SAML 2.0 Web browser SSO for a service provider: the AuthnRequest that goes to the identity
/// provider, and the checking of what comes back. The checking is the part that has to be right:
/// XML signatures (exclusive canonicalization, enveloped RSA signatures) verified against the one
/// certificate the administrator configured, never against a key the message brings itself.
namespace nc::saml {

template<typename Value> using Result = util::expected<Value, std::string>;

struct Settings
{
    std::string sp_entity_id{};
    std::string acs_url{}; // where the identity provider posts the response
    std::string idp_entity_id{};
    std::string idp_certificate_pem{}; // the identity provider's signing certificate
    int skew_seconds{120};             // clock difference that is tolerated
};

/// What a valid response says about the person.
struct Assertion
{
    std::string id{};
    std::string name_id{};
    std::int64_t not_on_or_after{0}; // when this assertion stops being acceptable (replay window)
    std::map<std::string, std::vector<std::string>> attributes{};
};

/// @brief Checks a SAML response (the decoded XML) and returns its assertion. Accepted only if: the
/// XML has no DTD, it is a successful Response to the request `request_id` sent to `acs_url`, it
/// has exactly one unencrypted Assertion from the configured identity provider whose own signature
/// or whose Response's signature verifies with the configured certificate (RSA with SHA-256 or
/// SHA-512, exclusive canonicalization, a single reference to the signed element, whose ID occurs
/// once in the document), and the conditions (time, audience, recipient, bearer confirmation) hold.
[[nodiscard]] Result<Assertion> validate_response(
    std::string_view xml,
    const Settings& settings,
    std::string_view request_id,
    std::int64_t now
);

/// @brief The AuthnRequest XML.
[[nodiscard]] std::string build_authn_request(
    const Settings& settings,
    std::string_view request_id,
    std::string_view destination,
    std::int64_t now
);

/// @brief The URL of the HTTP-Redirect binding: `destination?SAMLRequest=<deflated, base64,
/// escaped>&RelayState=...`.
[[nodiscard]] std::string redirect_url(
    std::string_view destination,
    std::string_view authn_request_xml,
    std::string_view relay_state
);

/// @brief The service provider's metadata document.
[[nodiscard]] std::string metadata(const Settings& settings);

/// @brief "2024-01-02T03:04:05Z" (fractions allowed) as seconds since the epoch; nullopt if it is
/// not a UTC time stamp.
[[nodiscard]] std::optional<std::int64_t> parse_time(std::string_view stamp);

} // namespace nc::saml
