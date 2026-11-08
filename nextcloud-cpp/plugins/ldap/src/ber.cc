#include "ber.h"

namespace nc::ldap::ber {

std::string encode_length(std::size_t length)
{
    if (length < 0x80) {
        return std::string(1, static_cast<char>(length));
    }
    std::string bytes;
    for (std::size_t rest = length; rest > 0; rest >>= 8U) {
        bytes.insert(bytes.begin(), static_cast<char>(rest & 0xFFU));
    }
    return std::string(1, static_cast<char>(0x80U | bytes.size())) + bytes;
}

std::string element(unsigned char tag, std::string_view content)
{
    return std::string(1, static_cast<char>(tag)) + encode_length(content.size()) +
           std::string{content};
}

std::string integer(std::int64_t value, unsigned char tag)
{
    std::string bytes;
    // Two's complement, shortest form.
    std::int64_t rest = value;
    do {
        bytes.insert(bytes.begin(), static_cast<char>(rest & 0xFF));
        rest >>= 8;
    } while (
        !((rest == 0 && (static_cast<unsigned char>(bytes.front()) & 0x80U) == 0) ||
          (rest == -1 && (static_cast<unsigned char>(bytes.front()) & 0x80U) != 0))
    );
    return element(tag, bytes);
}

std::string octets(std::string_view value)
{
    return element(OCTET_STRING, value);
}

std::optional<std::size_t> header_size(std::string_view buffer, std::size_t& content_length)
{
    if (buffer.size() < 2) {
        return std::size_t{0};
    }
    const auto first = static_cast<unsigned char>(buffer[1]);
    if (first < 0x80U) {
        content_length = first;
        return std::size_t{2};
    }
    const std::size_t count = first & 0x7FU;
    if (count == 0 || count > 4) {
        return std::nullopt; // indefinite or absurdly long
    }
    if (buffer.size() < 2 + count) {
        return std::size_t{0};
    }
    content_length = 0;
    for (std::size_t index = 0; index < count; ++index) {
        content_length = (content_length << 8U) | static_cast<unsigned char>(buffer[2 + index]);
    }
    return 2 + count;
}

std::optional<std::size_t> complete_length(std::string_view buffer)
{
    std::size_t content = 0;
    const auto header = header_size(buffer, content);
    if (!header) {
        return std::nullopt;
    }
    if (*header == 0 || buffer.size() < *header + content) {
        return std::size_t{0};
    }
    return *header + content;
}

std::optional<Element> read(std::string_view& input)
{
    std::size_t content = 0;
    const auto header = header_size(input, content);
    if (!header || *header == 0 || input.size() < *header + content) {
        return std::nullopt;
    }
    Element out{static_cast<unsigned char>(input[0]), input.substr(*header, content)};
    input.remove_prefix(*header + content);
    return out;
}

std::optional<std::int64_t> as_integer(const Element& value)
{
    if (value.content.empty() || value.content.size() > 8) {
        return std::nullopt;
    }
    std::int64_t out = (static_cast<unsigned char>(value.content[0]) & 0x80U) != 0 ? -1 : 0;
    for (const char byte: value.content) {
        out = (out << 8) | static_cast<unsigned char>(byte);
    }
    return out;
}

} // namespace nc::ldap::ber
