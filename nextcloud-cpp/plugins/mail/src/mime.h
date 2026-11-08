#pragma once

#include "mail_message.h"
#include "nextcloud/util/expected.h"

#include <chrono>
#include <string>
#include <string_view>

namespace nc::mail {

template<typename Value> using Result = util::expected<Value, std::string>;

/// @brief Encodes a header value that has non-ASCII characters as RFC 2047 encoded words
/// (`=?UTF-8?B?...?=`); plain ASCII is returned unchanged. Never splits a UTF-8 sequence.
[[nodiscard]] std::string encode_header_value(std::string_view value);

/// @brief Base64 with a CRLF every 76 characters, the body encoding of every part.
[[nodiscard]] std::string wrap_base64(std::string_view bytes);

/// @brief Builds the RFC 5322 text of a message.
///
/// Fails when an address is invalid, there is no recipient or no body, or a header value contains a
/// line break (header injection). A message with a plain and an HTML body becomes
/// `multipart/alternative`. `boundary_seed` and `now` make the output reproducible in tests.
[[nodiscard]] Result<std::string> build_message(
    const MailMessage& message,
    std::chrono::system_clock::time_point now = std::chrono::system_clock::now(),
    std::string_view boundary_seed = {}
);

} // namespace nc::mail
