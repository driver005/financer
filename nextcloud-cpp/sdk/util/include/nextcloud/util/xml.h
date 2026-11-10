#pragma once

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace nc::util {

/// @brief A parsed XML element, reduced to what the DAV and S3 code reads: elements are found by
/// their local name (the prefix is whatever the client chose: `d:href`, `D:href` and `href` in a
/// default namespace are the same), text has its entities and CDATA resolved, attributes are found
/// by their local name. It copies what it needs out of the document, so nothing here points into
/// libxml2.
class Xml
{
public:
    /// @brief The root element of `xml`; nullopt for anything that is not exactly one well formed
    /// document. Refused: a DTD (so no entity can name a file, a URL or expand into a bomb), more
    /// than `max_bytes` of input, nesting deeper than 64 levels, more than 200000 elements.
    [[nodiscard]] static std::optional<Xml>
    parse(std::string_view xml, std::size_t max_bytes = 4U << 20U);

    /// @brief The local name: `href` for `<d:href>`.
    [[nodiscard]] const std::string& name() const noexcept
    {
        return m_name;
    }

    /// @brief The namespace URI of the element, "" when it has none.
    [[nodiscard]] const std::string& ns() const noexcept
    {
        return m_ns;
    }

    /// @brief The text directly inside this element (not inside its children), trimmed.
    [[nodiscard]] const std::string& text() const noexcept
    {
        return m_text;
    }

    /// @brief The same text as it is, spaces included (an S3 key may start or end with one).
    [[nodiscard]] const std::string& raw_text() const noexcept
    {
        return m_raw;
    }

    /// @brief The value of the attribute with this local name, or "".
    [[nodiscard]] std::string attribute(std::string_view name) const;

    [[nodiscard]] const std::vector<Xml>& children() const noexcept
    {
        return m_children;
    }

    /// @brief The first element below this one (in document order) with this local name.
    [[nodiscard]] const Xml* find(std::string_view name) const noexcept;

    /// @brief Every element below this one with this local name, in document order. An element that
    /// matches is still searched for further matches inside it.
    [[nodiscard]] std::vector<const Xml*> find_all(std::string_view name) const;

    /// @brief The trimmed texts of `find_all(name)`.
    [[nodiscard]] std::vector<std::string> texts(std::string_view name) const;

private:
    friend class XmlBuilder;

    std::string m_name{};
    std::string m_ns{};
    std::string m_text{};
    std::string m_raw{};
    std::vector<std::pair<std::string, std::string>> m_attributes{};
    std::vector<Xml> m_children{};
};

} // namespace nc::util
