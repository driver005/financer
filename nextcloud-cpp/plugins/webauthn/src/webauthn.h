#pragma once

#include "nextcloud/util/expected.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

/// WebAuthn (passkeys and security keys) as a relying party: the checks of W3C WebAuthn level 2 for
/// registering a credential (attestation "none", which is what is asked for) and for signing in
/// with one. Keys: ES256 (P-256), RS256 (2048 bits or more) and EdDSA (Ed25519). The CBOR is read
/// by jsoncons, the signatures are checked by BoringSSL. Counterpart of Nextcloud's
/// `OC\Authentication\WebAuthn\Manager`.
namespace nc::webauthn {

template<typename Value> using Result = util::expected<Value, std::string>;

/// Who is asking: the relying party id (a host name) and the origins pages may come from.
struct RelyingParty
{
    std::string id{};
    std::vector<std::string> origins{};
};

/// What is kept of a registered credential.
struct Credential
{
    std::string id{};          // the credential id (raw bytes)
    std::string public_key{};  // DER SubjectPublicKeyInfo
    std::int32_t algorithm{0}; // COSE: -7 ES256, -257 RS256, -8 EdDSA
    std::uint32_t counter{0};
    bool user_verified{false};
};

/// The parts of the `PublicKeyCredential` JSON a browser produced (Nextcloud passes it as `data`).
struct ClientResponse
{
    std::string credential_id{};      // raw bytes
    std::string client_data_json{};   // raw bytes
    std::string attestation_object{}; // registration
    std::string authenticator_data{}; // sign-in
    std::string signature{};          // sign-in
};

/// @brief Reads the JSON of `navigator.credentials.create/get()` (ids and buffers base64url, as
/// `PublicKeyCredential.toJSON()` and Nextcloud's front end write them). `registration` selects
/// which of the two shapes is expected.
[[nodiscard]] Result<ClientResponse>
parse_client_response(std::string_view json, bool registration);

/// @brief The challenge (raw bytes) a client data JSON carries, so the caller can find the
/// request it answers before verifying; fails when the JSON is not usable.
[[nodiscard]] Result<std::string> challenge_of(std::string_view client_data_json);

/// @brief Checks a registration against the challenge that was issued: type, challenge, origin,
/// the relying party hash, attestation "none", the key. With `require_user_verification` the
/// authenticator has to have verified the person (PIN, biometrics).
[[nodiscard]] Result<Credential> verify_registration(
    const RelyingParty& party,
    std::string_view challenge,
    const ClientResponse& response,
    bool require_user_verification
);

/// What a good sign-in says.
struct Assertion
{
    std::uint32_t counter{0};
    bool user_verified{false};
};

/// @brief Checks a sign-in against the stored credential and the challenge that was issued. The
/// counter must have grown when either side uses one (else the authenticator may be cloned).
[[nodiscard]] Result<Assertion> verify_assertion(
    const RelyingParty& party,
    const Credential& stored,
    std::string_view challenge,
    const ClientResponse& response,
    bool require_user_verification
);

/// @brief base64url without padding.
[[nodiscard]] std::string base64url_encode(std::string_view bytes);
[[nodiscard]] Result<std::string> base64url_decode(std::string_view text);

} // namespace nc::webauthn
