#include "nextcloud/util/json.h"

#include <cmath>
#include <nlohmann/json.hpp>

namespace nc::util {

namespace {

    constexpr std::size_t MAX_JSON_BYTES = 1U << 20U;
    // A container may sit inside up to 32 others: 33 levels of nesting in all.
    constexpr std::size_t MAX_JSON_NESTING = 33;

} // namespace

/// Builds a `Json` from the events of nlohmann's parser. The parsing itself (RFC 8259: strings,
/// escapes, surrogate pairs, UTF-8, numbers) is the library's; what is added here are the limits
/// that make it safe to read what other servers send, and the shape of `Json`.
class JsonParser final : public nlohmann::json::json_sax_t
{
public:
    explicit JsonParser(Json& root) noexcept :
        m_root{&root}
    {
    }

    bool null() override
    {
        return place(Json{}) != nullptr;
    }

    bool boolean(bool value) override
    {
        Json json;
        json.m_kind = Json::Kind::BOOLEAN;
        json.m_boolean = value;
        return place(std::move(json)) != nullptr;
    }

    bool number_integer(number_integer_t value) override
    {
        return number(static_cast<double>(value));
    }

    bool number_unsigned(number_unsigned_t value) override
    {
        return number(static_cast<double>(value));
    }

    bool number_float(number_float_t value, const string_t&) override
    {
        return number(value);
    }

    bool string(string_t& value) override
    {
        Json json;
        json.m_kind = Json::Kind::STRING;
        json.m_string = value;
        return place(std::move(json)) != nullptr;
    }

    bool binary(binary_t&) override
    {
        return false; // not a thing in JSON text
    }

    bool start_object(std::size_t) override
    {
        return open(Json::Kind::OBJECT);
    }

    bool key(string_t& value) override
    {
        m_key = value;
        return true;
    }

    bool end_object() override
    {
        return close();
    }

    bool start_array(std::size_t) override
    {
        return open(Json::Kind::ARRAY);
    }

    bool end_array() override
    {
        return close();
    }

    bool parse_error(std::size_t, const std::string&, const nlohmann::json::exception&) override
    {
        return false;
    }

private:
    bool number(double value)
    {
        if (!std::isfinite(value)) {
            return false;
        }
        Json json;
        json.m_kind = Json::Kind::NUMBER;
        json.m_number = value;
        return place(std::move(json)) != nullptr;
    }

    bool open(Json::Kind kind)
    {
        if (m_open.size() >= MAX_JSON_NESTING) {
            return false;
        }
        Json json;
        json.m_kind = kind;
        Json* placed = place(std::move(json));
        if (placed == nullptr) {
            return false;
        }
        m_open.push_back(placed);
        return true;
    }

    bool close()
    {
        if (m_open.empty()) {
            return false;
        }
        m_open.pop_back();
        return true;
    }

    /// Puts a finished value where it belongs: the root, the open array, or the open object (a
    /// repeated key replaces the earlier member: the last one wins).
    Json* place(Json value)
    {
        if (m_open.empty()) {
            *m_root = std::move(value);
            return m_root;
        }
        Json& parent = *m_open.back();
        if (parent.m_kind == Json::Kind::ARRAY) {
            parent.m_items.push_back(std::move(value));
            return &parent.m_items.back();
        }
        Json& member = parent.m_members[m_key];
        member = std::move(value);
        return &member;
    }

    Json* m_root;
    std::vector<Json*> m_open{};
    std::string m_key{};
};

std::optional<Json> Json::parse(std::string_view text)
{
    // Bytes of a byte order mark are not JSON (RFC 8259 section 8.1 lets a parser refuse them).
    if (text.size() > MAX_JSON_BYTES || text.starts_with("\xEF\xBB\xBF")) {
        return std::nullopt;
    }
    Json root;
    JsonParser handler{root};
    try {
        if (!nlohmann::json::sax_parse(text.begin(), text.end(), &handler)) {
            return std::nullopt;
        }
    } catch (const std::exception&) {
        return std::nullopt;
    }
    return root;
}

const Json& Json::operator[](std::string_view key) const noexcept
{
    static const Json NOTHING;
    const auto found = m_members.find(key);
    return found == m_members.end() ? NOTHING : found->second;
}

} // namespace nc::util
