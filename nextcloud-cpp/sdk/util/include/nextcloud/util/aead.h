#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace nc::util {

/// @brief ChaCha20-Poly1305 (RFC 8439). `key` is 32 bytes, `nonce` 12 bytes (never reuse a nonce
/// with a key). Returns the ciphertext followed by the 16 byte tag; throws std::invalid_argument
/// for a bad key or nonce size.
[[nodiscard]] std::string chacha20_poly1305_seal(
    std::string_view key,
    std::string_view nonce,
    std::string_view aad,
    std::string_view plaintext
);

/// @brief The plaintext, or nullopt when the tag does not match (wrong key, wrong nonce or
/// associated data, or the data was changed). The tag is compared in constant time and nothing is
/// decrypted before it matches.
[[nodiscard]] std::optional<std::string> chacha20_poly1305_open(
    std::string_view key,
    std::string_view nonce,
    std::string_view aad,
    std::string_view sealed
);

} // namespace nc::util
