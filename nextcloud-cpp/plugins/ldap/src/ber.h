#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace nc::ldap {

/// @brief The part of ASN.1 BER that LDAP uses (RFC 4511, RFC 4515 filters): definite lengths,
/// small integers, octet strings.
namespace ber {

    inline constexpr unsigned char INTEGER = 0x02;
    inline constexpr unsigned char OCTET_STRING = 0x04;
    inline constexpr unsigned char ENUMERATED = 0x0a;
    inline constexpr unsigned char SEQUENCE = 0x30;
    inline constexpr unsigned char SET = 0x31;
    inline constexpr unsigned char BIND_REQUEST = 0x60;
    inline constexpr unsigned char BIND_RESPONSE = 0x61;
    inline constexpr unsigned char UNBIND_REQUEST = 0x42;
    inline constexpr unsigned char SEARCH_REQUEST = 0x63;
    inline constexpr unsigned char SEARCH_ENTRY = 0x64;
    inline constexpr unsigned char SEARCH_DONE = 0x65;
    inline constexpr unsigned char SIMPLE_AUTH = 0x80;
    inline constexpr unsigned char FILTER_AND = 0xa0;
    inline constexpr unsigned char FILTER_EQUALITY = 0xa3;

    /// One element: its tag and its content bytes (a view into the buffer that was parsed).
    struct Element
    {
        unsigned char tag{0};
        std::string_view content{};
    };

    [[nodiscard]] std::string encode_length(std::size_t length);
    [[nodiscard]] std::string element(unsigned char tag, std::string_view content);
    [[nodiscard]] std::string integer(std::int64_t value, unsigned char tag = INTEGER);
    [[nodiscard]] std::string octets(std::string_view value);

    /// @brief Reads the element at the front of `input` and removes it. nullopt when the bytes are
    /// cut off or malformed (indefinite lengths and lengths over 4 bytes are refused).
    [[nodiscard]] std::optional<Element> read(std::string_view& input);

    /// @brief The value of an INTEGER or ENUMERATED element.
    [[nodiscard]] std::optional<std::int64_t> as_integer(const Element& element);

    /// @brief How many bytes of `buffer` make up the first complete element, or 0 while more is
    /// needed; nullopt for a malformed header.
    [[nodiscard]] std::optional<std::size_t>
    header_size(std::string_view buffer, std::size_t& content_length);

    [[nodiscard]] std::optional<std::size_t> complete_length(std::string_view buffer);

} // namespace ber
} // namespace nc::ldap
