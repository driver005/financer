#include "nextcloud/util/text.h"

#include <algorithm>
#include <cctype>

namespace nc::util {

namespace {

    int hex_value(char letter) noexcept
    {
        if (letter >= '0' && letter <= '9') {
            return letter - '0';
        }
        if (letter >= 'a' && letter <= 'f') {
            return letter - 'a' + 10;
        }
        if (letter >= 'A' && letter <= 'F') {
            return letter - 'A' + 10;
        }
        return -1;
    }

    bool is_unreserved(unsigned char letter) noexcept
    {
        return std::isalnum(letter) != 0 || letter == '-' || letter == '_' || letter == '.' ||
               letter == '~' || letter == '/';
    }

} // namespace

std::string to_lower(std::string_view text)
{
    std::string out(text);
    std::ranges::transform(
        out,
        out.begin(),
        [](unsigned char letter)
        {
            return static_cast<char>(std::tolower(letter));
        }
    );
    return out;
}

bool equals_ignore_case(std::string_view left, std::string_view right) noexcept
{
    return std::ranges::equal(
        left,
        right,
        [](unsigned char a, unsigned char b)
        {
            return std::tolower(a) == std::tolower(b);
        }
    );
}

std::vector<std::string> split(std::string_view text, char separator)
{
    std::vector<std::string> parts;
    std::size_t start = 0;
    while (true) {
        const std::size_t end = text.find(separator, start);
        if (end == std::string_view::npos) {
            parts.emplace_back(text.substr(start));
            return parts;
        }
        parts.emplace_back(text.substr(start, end - start));
        start = end + 1;
    }
}

std::string_view trim(std::string_view text) noexcept
{
    while (!text.empty() && std::isspace(static_cast<unsigned char>(text.front())) != 0) {
        text.remove_prefix(1);
    }
    while (!text.empty() && std::isspace(static_cast<unsigned char>(text.back())) != 0) {
        text.remove_suffix(1);
    }
    return text;
}

bool starts_with(std::string_view text, std::string_view prefix) noexcept
{
    return text.substr(0, prefix.size()) == prefix;
}

std::string url_decode(std::string_view text, bool plus_is_space)
{
    std::string out;
    out.reserve(text.size());
    for (std::size_t index = 0; index < text.size(); ++index) {
        const char letter = text[index];
        if (letter == '%' && index + 2 < text.size() && hex_value(text[index + 1]) >= 0 &&
            hex_value(text[index + 2]) >= 0) {
            out.push_back(
                static_cast<char>(hex_value(text[index + 1]) * 16 + hex_value(text[index + 2]))
            );
            index += 2;
        } else if (letter == '+' && plus_is_space) {
            out.push_back(' ');
        } else {
            out.push_back(letter);
        }
    }
    return out;
}

std::string url_encode_path(std::string_view text)
{
    static constexpr std::string_view DIGITS = "0123456789ABCDEF";
    std::string out;
    for (const char letter: text) {
        const auto byte = static_cast<unsigned char>(letter);
        if (is_unreserved(byte)) {
            out.push_back(letter);
        } else {
            out.push_back('%');
            out.push_back(DIGITS[byte >> 4U]);
            out.push_back(DIGITS[byte & 0x0FU]);
        }
    }
    return out;
}

std::vector<std::pair<std::string, std::string>> parse_form(std::string_view text)
{
    std::vector<std::pair<std::string, std::string>> form;
    for (const std::string& part: split(text, '&')) {
        if (part.empty()) {
            continue;
        }
        const std::size_t equals = part.find('=');
        form.emplace_back(
            url_decode(part.substr(0, equals), true),
            equals == std::string::npos ? std::string{} : url_decode(part.substr(equals + 1), true)
        );
    }
    return form;
}

std::string
form_value(const std::vector<std::pair<std::string, std::string>>& form, std::string_view key)
{
    for (const auto& pair: form) {
        if (pair.first == key) {
            return pair.second;
        }
    }
    return {};
}

std::string form_encode(const std::vector<std::pair<std::string, std::string>>& form)
{
    static constexpr std::string_view DIGITS = "0123456789ABCDEF";
    const auto encode = [](std::string_view value)
    {
        std::string out;
        for (const char letter: value) {
            const auto byte = static_cast<unsigned char>(letter);
            if (std::isalnum(byte) != 0 || byte == '-' || byte == '_' || byte == '.' ||
                byte == '~') {
                out.push_back(letter);
            } else {
                out.push_back('%');
                out.push_back(DIGITS[byte >> 4U]);
                out.push_back(DIGITS[byte & 0x0FU]);
            }
        }
        return out;
    };
    std::string out;
    for (const auto& [key, value]: form) {
        out += out.empty() ? "" : "&";
        out += encode(key) + "=" + encode(value);
    }
    return out;
}

std::string_view mime_type_for(std::string_view file_name) noexcept
{
    struct Entry
    {
        std::string_view extension;
        std::string_view type;
    };

    static constexpr Entry TYPES[] = {
        {"txt", "text/plain"},        {"md", "text/markdown"},    {"html", "text/html"},
        {"htm", "text/html"},         {"css", "text/css"},        {"csv", "text/csv"},
        {"json", "application/json"}, {"xml", "application/xml"}, {"pdf", "application/pdf"},
        {"zip", "application/zip"},   {"gz", "application/gzip"}, {"png", "image/png"},
        {"jpg", "image/jpeg"},        {"jpeg", "image/jpeg"},     {"gif", "image/gif"},
        {"svg", "image/svg+xml"},     {"webp", "image/webp"},     {"mp3", "audio/mpeg"},
        {"mp4", "video/mp4"},         {"ics", "text/calendar"},   {"vcf", "text/vcard"},
    };
    const std::size_t dot = file_name.rfind('.');
    if (dot == std::string_view::npos) {
        return "application/octet-stream";
    }
    const std::string_view extension = file_name.substr(dot + 1);
    for (const Entry& entry: TYPES) {
        if (equals_ignore_case(extension, entry.extension)) {
            return entry.type;
        }
    }
    return "application/octet-stream";
}

bool is_valid_email(std::string_view email) noexcept
{
    const std::size_t at = email.find('@');
    if (at == std::string_view::npos || at == 0 || at + 1 >= email.size() || email.size() > 254 ||
        email.find('@', at + 1) != std::string_view::npos) {
        return false;
    }
    const std::string_view domain = email.substr(at + 1);
    return domain.find('.') != std::string_view::npos && domain.front() != '.' &&
           domain.back() != '.' && domain.find("..") == std::string_view::npos &&
           std::ranges::none_of(
               email,
               [](char letter)
               {
                   const auto byte = static_cast<unsigned char>(letter);
                   return std::isspace(byte) != 0 || byte < 0x20 || byte == 0x7f || letter == '<' ||
                          letter == '>' || letter == ',' || letter == ';' || letter == '"' ||
                          letter == '(' || letter == ')';
               }
           );
}

std::string xml_escape(std::string_view text)
{
    std::string out;
    for (const char letter: text) {
        switch (letter) {
            case '&':
                out += "&amp;";
                break;
            case '<':
                out += "&lt;";
                break;
            case '>':
                out += "&gt;";
                break;
            case '"':
                out += "&quot;";
                break;
            case '\'':
                out += "&apos;";
                break;
            default:
                out.push_back(letter);
        }
    }
    return out;
}

std::string json_escape(std::string_view text)
{
    static constexpr std::string_view DIGITS = "0123456789abcdef";
    std::string out;
    for (const char letter: text) {
        const auto byte = static_cast<unsigned char>(letter);
        switch (letter) {
            case '"':
                out += "\\\"";
                break;
            case '\\':
                out += "\\\\";
                break;
            case '\n':
                out += "\\n";
                break;
            case '\r':
                out += "\\r";
                break;
            case '\t':
                out += "\\t";
                break;
            default:
                if (byte < 0x20U) {
                    out += "\\u00";
                    out.push_back(DIGITS[byte >> 4U]);
                    out.push_back(DIGITS[byte & 0x0FU]);
                } else {
                    out.push_back(letter);
                }
        }
    }
    return out;
}

} // namespace nc::util
