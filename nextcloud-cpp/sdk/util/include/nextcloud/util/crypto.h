#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace nc::util {

/// @brief SHA-256 of `data`, as 32 raw bytes.
[[nodiscard]] std::string sha256(std::string_view data);

/// @brief HMAC-SHA-256, 32 raw bytes.
[[nodiscard]] std::string hmac_sha256(std::string_view key, std::string_view message);

/// @brief PBKDF2 with HMAC-SHA-256, 32 raw bytes of output.
[[nodiscard]] std::string
pbkdf2_sha256(std::string_view password, std::string_view salt, std::uint32_t iterations);

/// @brief SHA-1 (20 raw bytes). Only for TOTP (RFC 6238), where the standard requires it.
[[nodiscard]] std::string sha1(std::string_view data);

/// @brief HMAC-SHA-1 (20 raw bytes), for TOTP.
[[nodiscard]] std::string hmac_sha1(std::string_view key, std::string_view message);

/// @brief RFC 4648 base32 without padding, the encoding of authenticator app secrets.
[[nodiscard]] std::string base32_encode(std::string_view bytes);
[[nodiscard]] std::optional<std::string> base32_decode(std::string_view text);

/// @brief HOTP value (RFC 4226) of `counter` with `digits` digits.
[[nodiscard]] std::string hotp(std::string_view secret, std::uint64_t counter, int digits = 6);

[[nodiscard]] std::string to_hex(std::string_view bytes);

/// @brief Decodes hexadecimal digits (either case); nullopt for an odd length or a bad digit.
[[nodiscard]] std::optional<std::string> from_hex(std::string_view hex);

[[nodiscard]] std::string base64_encode(std::string_view bytes);

/// @brief Decodes standard base64 (padding optional); nullopt on any invalid character.
[[nodiscard]] std::optional<std::string> base64_decode(std::string_view text);

/// @brief `count` random bytes from the operating system, hex-encoded (so `2 * count` characters).
[[nodiscard]] std::string random_hex(std::size_t count);

/// @brief Compares two byte strings in time that depends only on their length.
[[nodiscard]] bool constant_time_equals(std::string_view left, std::string_view right) noexcept;

} // namespace nc::util
