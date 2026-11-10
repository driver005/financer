#include "nextcloud/util/xml.h"

#include "nextcloud/util/text.h"

#include <libxml/parser.h>
#include <libxml/tree.h>
#include <memory>
#include <utility>

namespace nc::util {

namespace {

    constexpr int MAX_DEPTH = 64;
    constexpr std::size_t MAX_ELEMENTS = 200'000;

    struct DocDeleter
    {
        void operator()(xmlDoc* doc) const noexcept
        {
            xmlFreeDoc(doc);
        }
    };

    std::string text_of(const xmlChar* value)
    {
        return value == nullptr ? std::string{} : std::string{reinterpret_cast<const char*>(value)};
    }

    void collect(const Xml& element, std::string_view name, std::vector<const Xml*>& out)
    {
        for (const Xml& child: element.children()) {
            if (child.name() == name) {
                out.push_back(&child);
            }
            collect(child, name, out);
        }
    }

} // namespace

class XmlBuilder
{
public:
    /// Copies `node` and what is below it; false when a limit is passed.
    static bool build(const xmlNode* node, Xml& out, int depth, std::size_t& count)
    {
        if (depth > MAX_DEPTH || ++count > MAX_ELEMENTS) {
            return false;
        }
        out.m_name = text_of(node->name);
        out.m_ns = node->ns == nullptr ? std::string{} : text_of(node->ns->href);
        for (const xmlAttr* attribute = node->properties; attribute != nullptr;
             attribute = attribute->next) {
            xmlChar* value = xmlNodeListGetString(node->doc, attribute->children, 1);
            out.m_attributes.emplace_back(text_of(attribute->name), text_of(value));
            if (value != nullptr) {
                xmlFree(value);
            }
        }
        std::string text;
        for (const xmlNode* child = node->children; child != nullptr; child = child->next) {
            if (child->type == XML_TEXT_NODE || child->type == XML_CDATA_SECTION_NODE) {
                text += text_of(child->content);
            } else if (child->type == XML_ELEMENT_NODE) {
                Xml element;
                if (!build(child, element, depth + 1, count)) {
                    return false;
                }
                out.m_children.push_back(std::move(element));
            }
            // Comments and processing instructions are not content.
        }
        out.m_text = std::string{trim(text)};
        out.m_raw = std::move(text);
        return true;
    }
};

std::optional<Xml> Xml::parse(std::string_view xml, std::size_t max_bytes)
{
    if (xml.empty() || xml.size() > max_bytes || xml.find("<!DOCTYPE") != std::string_view::npos ||
        xml.find("<!ENTITY") != std::string_view::npos) {
        return std::nullopt;
    }
    // No network, no external entities, no entity substitution (the entities of the XML itself,
    // such as &amp;, are still resolved), no DTD loading.
    const std::unique_ptr<xmlDoc, DocDeleter> doc{xmlReadMemory(
        xml.data(),
        static_cast<int>(xml.size()),
        nullptr,
        nullptr,
        XML_PARSE_NONET | XML_PARSE_NOERROR | XML_PARSE_NOWARNING | XML_PARSE_NO_XXE
    )};
    if (doc == nullptr || doc->intSubset != nullptr || doc->extSubset != nullptr) {
        return std::nullopt;
    }
    const xmlNode* root = xmlDocGetRootElement(doc.get());
    if (root == nullptr) {
        return std::nullopt;
    }
    Xml out;
    std::size_t count = 0;
    if (!XmlBuilder::build(root, out, 0, count)) {
        return std::nullopt;
    }
    return out;
}

std::string Xml::attribute(std::string_view name) const
{
    for (const auto& [key, value]: m_attributes) {
        if (key == name) {
            return value;
        }
    }
    return {};
}

const Xml* Xml::find(std::string_view name) const noexcept
{
    for (const Xml& child: m_children) {
        if (child.m_name == name) {
            return &child;
        }
        if (const Xml* deeper = child.find(name)) {
            return deeper;
        }
    }
    return nullptr;
}

std::vector<const Xml*> Xml::find_all(std::string_view name) const
{
    std::vector<const Xml*> found;
    collect(*this, name, found);
    return found;
}

std::vector<std::string> Xml::texts(std::string_view name) const
{
    std::vector<std::string> values;
    for (const Xml* element: find_all(name)) {
        values.push_back(element->text());
    }
    return values;
}

} // namespace nc::util
