#pragma once

#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace nc::util {

/// @brief A parsed JSON value (RFC 8259). Small and strict: it exists to read what other servers
/// send (federation, discovery documents), so it limits depth and size instead of trusting its
/// input.
class Json
{
public:
    enum class Kind
    {
        NUL,
        BOOLEAN,
        NUMBER,
        STRING,
        ARRAY,
        OBJECT
    };

    Json() noexcept = default;

    /// @brief nullopt for anything that is not exactly one JSON value (trailing text, bad escapes,
    /// nesting deeper than 32 levels, input over 1 MiB, duplicate keys are not an error: the last
    /// wins).
    [[nodiscard]] static std::optional<Json> parse(std::string_view text);

    [[nodiscard]] Kind kind() const noexcept
    {
        return m_kind;
    }

    [[nodiscard]] bool is_object() const noexcept
    {
        return m_kind == Kind::OBJECT;
    }

    [[nodiscard]] bool is_array() const noexcept
    {
        return m_kind == Kind::ARRAY;
    }

    [[nodiscard]] bool is_string() const noexcept
    {
        return m_kind == Kind::STRING;
    }

    [[nodiscard]] bool is_number() const noexcept
    {
        return m_kind == Kind::NUMBER;
    }

    [[nodiscard]] bool is_bool() const noexcept
    {
        return m_kind == Kind::BOOLEAN;
    }

    /// @brief The string, or "" when this is not a string.
    [[nodiscard]] const std::string& string() const noexcept
    {
        return m_string;
    }

    [[nodiscard]] double number() const noexcept
    {
        return m_number;
    }

    [[nodiscard]] bool boolean() const noexcept
    {
        return m_boolean;
    }

    [[nodiscard]] const std::vector<Json>& items() const noexcept
    {
        return m_items;
    }

    /// @brief The member of an object, or a null value when there is none (so chains like
    /// `json["a"]["b"].string()` never fail).
    [[nodiscard]] const Json& operator[](std::string_view key) const noexcept;

private:
    friend class JsonParser;

    Kind m_kind{Kind::NUL};
    std::string m_string{};
    double m_number{0};
    bool m_boolean{false};
    std::vector<Json> m_items{};
    std::map<std::string, Json, std::less<>> m_members{};
};

} // namespace nc::util
