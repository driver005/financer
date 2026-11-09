#include "nextcloud/util/json.h"

#include <cmath>
#include <cstdlib>

namespace nc::util {

namespace {

    constexpr std::size_t MAX_JSON_BYTES = 1U << 20U;
    constexpr int MAX_JSON_DEPTH = 32;

    void append_utf8(std::string& out, std::uint32_t code)
    {
        if (code < 0x80U) {
            out.push_back(static_cast<char>(code));
        } else if (code < 0x8'00U) {
            out.push_back(static_cast<char>(0xC0U | (code >> 6U)));
            out.push_back(static_cast<char>(0x80U | (code & 0x3FU)));
        } else if (code < 0x1'00'00U) {
            out.push_back(static_cast<char>(0xE0U | (code >> 12U)));
            out.push_back(static_cast<char>(0x80U | ((code >> 6U) & 0x3FU)));
            out.push_back(static_cast<char>(0x80U | (code & 0x3FU)));
        } else {
            out.push_back(static_cast<char>(0xF0U | (code >> 18U)));
            out.push_back(static_cast<char>(0x80U | ((code >> 12U) & 0x3FU)));
            out.push_back(static_cast<char>(0x80U | ((code >> 6U) & 0x3FU)));
            out.push_back(static_cast<char>(0x80U | (code & 0x3FU)));
        }
    }

} // namespace

class JsonParser
{
public:
    explicit JsonParser(std::string_view text) noexcept :
        m_text{text}
    {
    }

    std::optional<Json> run()
    {
        if (m_text.size() > MAX_JSON_BYTES) {
            return std::nullopt;
        }
        Json value;
        skip();
        if (!parse_value(value, 0)) {
            return std::nullopt;
        }
        skip();
        if (m_at != m_text.size()) {
            return std::nullopt;
        }
        return value;
    }

private:
    void skip() noexcept
    {
        while (m_at < m_text.size() && (m_text[m_at] == ' ' || m_text[m_at] == '\t' ||
                                        m_text[m_at] == '\n' || m_text[m_at] == '\r')) {
            ++m_at;
        }
    }

    bool literal(std::string_view word) noexcept
    {
        if (m_text.substr(m_at, word.size()) == word) {
            m_at += word.size();
            return true;
        }
        return false;
    }

    bool hex4(std::uint32_t& out) noexcept
    {
        if (m_at + 4 > m_text.size()) {
            return false;
        }
        out = 0;
        for (int index = 0; index < 4; ++index) {
            const char letter = m_text[m_at++];
            out <<= 4U;
            if (letter >= '0' && letter <= '9') {
                out |= static_cast<std::uint32_t>(letter - '0');
            } else if (letter >= 'a' && letter <= 'f') {
                out |= static_cast<std::uint32_t>(letter - 'a' + 10);
            } else if (letter >= 'A' && letter <= 'F') {
                out |= static_cast<std::uint32_t>(letter - 'A' + 10);
            } else {
                return false;
            }
        }
        return true;
    }

    bool parse_string(std::string& out)
    {
        if (m_at >= m_text.size() || m_text[m_at] != '"') {
            return false;
        }
        ++m_at;
        while (m_at < m_text.size()) {
            const auto letter = static_cast<unsigned char>(m_text[m_at++]);
            if (letter == '"') {
                return true;
            }
            if (letter < 0x20U) {
                return false; // raw control characters are not allowed in a string
            }
            if (letter != '\\') {
                out.push_back(static_cast<char>(letter));
                continue;
            }
            if (m_at >= m_text.size()) {
                return false;
            }
            const char escape = m_text[m_at++];
            switch (escape) {
                case '"':
                case '\\':
                case '/':
                    out.push_back(escape);
                    break;
                case 'b':
                    out.push_back('\b');
                    break;
                case 'f':
                    out.push_back('\f');
                    break;
                case 'n':
                    out.push_back('\n');
                    break;
                case 'r':
                    out.push_back('\r');
                    break;
                case 't':
                    out.push_back('\t');
                    break;
                case 'u':
                    {
                        std::uint32_t code = 0;
                        if (!hex4(code)) {
                            return false;
                        }
                        if (code >= 0xD8'00U &&
                            code < 0xDC'00U) { // a surrogate pair is one character
                            std::uint32_t low = 0;
                            if (!literal("\\u") || !hex4(low) || low < 0xDC'00U || low > 0xDF'FFU) {
                                return false;
                            }
                            code = 0x1'00'00U + ((code - 0xD8'00U) << 10U) + (low - 0xDC'00U);
                        } else if (code >= 0xDC'00U && code <= 0xDF'FFU) {
                            return false;
                        }
                        append_utf8(out, code);
                        break;
                    }
                default:
                    return false;
            }
        }
        return false;
    }

    bool parse_value(Json& out, int depth)
    {
        if (depth > MAX_JSON_DEPTH || m_at >= m_text.size()) {
            return false;
        }
        const char first = m_text[m_at];
        if (first == '{') {
            ++m_at;
            out.m_kind = Json::Kind::OBJECT;
            skip();
            if (m_at < m_text.size() && m_text[m_at] == '}') {
                ++m_at;
                return true;
            }
            while (true) {
                skip();
                std::string key;
                if (!parse_string(key)) {
                    return false;
                }
                skip();
                if (m_at >= m_text.size() || m_text[m_at++] != ':') {
                    return false;
                }
                skip();
                Json member;
                if (!parse_value(member, depth + 1)) {
                    return false;
                }
                out.m_members[std::move(key)] = std::move(member);
                skip();
                if (m_at >= m_text.size()) {
                    return false;
                }
                const char separator = m_text[m_at++];
                if (separator == '}') {
                    return true;
                }
                if (separator != ',') {
                    return false;
                }
            }
        }
        if (first == '[') {
            ++m_at;
            out.m_kind = Json::Kind::ARRAY;
            skip();
            if (m_at < m_text.size() && m_text[m_at] == ']') {
                ++m_at;
                return true;
            }
            while (true) {
                skip();
                Json item;
                if (!parse_value(item, depth + 1)) {
                    return false;
                }
                out.m_items.push_back(std::move(item));
                skip();
                if (m_at >= m_text.size()) {
                    return false;
                }
                const char separator = m_text[m_at++];
                if (separator == ']') {
                    return true;
                }
                if (separator != ',') {
                    return false;
                }
            }
        }
        if (first == '"') {
            out.m_kind = Json::Kind::STRING;
            return parse_string(out.m_string);
        }
        if (literal("true")) {
            out.m_kind = Json::Kind::BOOLEAN;
            out.m_boolean = true;
            return true;
        }
        if (literal("false")) {
            out.m_kind = Json::Kind::BOOLEAN;
            return true;
        }
        if (literal("null")) {
            return true;
        }
        // A number: -?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?
        const std::size_t start = m_at;
        if (m_text[m_at] == '-') {
            ++m_at;
        }
        const auto digits = [this]
        {
            const std::size_t from = m_at;
            while (m_at < m_text.size() && m_text[m_at] >= '0' && m_text[m_at] <= '9') {
                ++m_at;
            }
            return m_at - from;
        };
        if (m_at < m_text.size() && m_text[m_at] == '0') {
            ++m_at;
        } else if (digits() == 0) {
            return false;
        }
        if (m_at < m_text.size() && m_text[m_at] == '.') {
            ++m_at;
            if (digits() == 0) {
                return false;
            }
        }
        if (m_at < m_text.size() && (m_text[m_at] == 'e' || m_text[m_at] == 'E')) {
            ++m_at;
            if (m_at < m_text.size() && (m_text[m_at] == '+' || m_text[m_at] == '-')) {
                ++m_at;
            }
            if (digits() == 0) {
                return false;
            }
        }
        out.m_kind = Json::Kind::NUMBER;
        out.m_number =
            std::strtod(std::string{m_text.substr(start, m_at - start)}.c_str(), nullptr);
        return std::isfinite(out.m_number);
    }

    std::string_view m_text;
    std::size_t m_at{0};
};

std::optional<Json> Json::parse(std::string_view text)
{
    return JsonParser{text}.run();
}

const Json& Json::operator[](std::string_view key) const noexcept
{
    static const Json NOTHING;
    const auto found = m_members.find(key);
    return found == m_members.end() ? NOTHING : found->second;
}

} // namespace nc::util
