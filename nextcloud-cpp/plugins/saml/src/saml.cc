#include "saml.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <ctime>
#include <libxml/c14n.h>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <libxml/xmlIO.h>
#include <memory>
#include <openssl/bio.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <set>
#include <zlib.h>

namespace nc::saml {

namespace {

    constexpr std::string_view NS_PROTOCOL = "urn:oasis:names:tc:SAML:2.0:protocol";
    constexpr std::string_view NS_ASSERTION = "urn:oasis:names:tc:SAML:2.0:assertion";
    constexpr std::string_view NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";
    constexpr std::string_view SUCCESS = "urn:oasis:names:tc:SAML:2.0:status:Success";
    constexpr std::string_view BEARER = "urn:oasis:names:tc:SAML:2.0:cm:bearer";
    constexpr std::string_view ALG_EXC_C14N = "http://www.w3.org/2001/10/xml-exc-c14n#";
    constexpr std::string_view ALG_ENVELOPED =
        "http://www.w3.org/2000/09/xmldsig#enveloped-signature";
    constexpr std::size_t MAX_XML = 1U << 20U;

    util::unexpected<std::string> failure(std::string message)
    {
        return util::unexpected<std::string>{std::move(message)};
    }

    struct DocDeleter
    {
        void operator()(xmlDoc* doc) const noexcept
        {
            xmlFreeDoc(doc);
        }
    };

    using Doc = std::unique_ptr<xmlDoc, DocDeleter>;

    // ---- small XML helpers ---------------------------------------------------------------------

    std::string_view name_of(const xmlNode* node) noexcept
    {
        return node != nullptr && node->name != nullptr
                   ? std::string_view{reinterpret_cast<const char*>(node->name)}
                   : std::string_view{};
    }

    std::string_view ns_of(const xmlNode* node) noexcept
    {
        return node != nullptr && node->ns != nullptr && node->ns->href != nullptr
                   ? std::string_view{reinterpret_cast<const char*>(node->ns->href)}
                   : std::string_view{};
    }

    bool is_element(const xmlNode* node, std::string_view ns, std::string_view name) noexcept
    {
        return node != nullptr && node->type == XML_ELEMENT_NODE && ns_of(node) == ns &&
               name_of(node) == name;
    }

    /// The first child element in a namespace with a name; nullptr if none.
    xmlNode* child(xmlNode* parent, std::string_view ns, std::string_view name) noexcept
    {
        for (xmlNode* at = parent == nullptr ? nullptr : parent->children; at != nullptr;
             at = at->next) {
            if (is_element(at, ns, name)) {
                return at;
            }
        }
        return nullptr;
    }

    std::size_t count_children(xmlNode* parent, std::string_view ns, std::string_view name) noexcept
    {
        std::size_t count = 0;
        for (xmlNode* at = parent == nullptr ? nullptr : parent->children; at != nullptr;
             at = at->next) {
            count += is_element(at, ns, name) ? 1U : 0U;
        }
        return count;
    }

    std::string attribute(const xmlNode* node, const char* name)
    {
        xmlChar* value = xmlGetNoNsProp(node, reinterpret_cast<const xmlChar*>(name));
        if (value == nullptr) {
            return {};
        }
        std::string out{reinterpret_cast<const char*>(value)};
        xmlFree(value);
        return out;
    }

    std::string text_of(xmlNode* node)
    {
        xmlChar* content = xmlNodeGetContent(node);
        if (content == nullptr) {
            return {};
        }
        std::string out{reinterpret_cast<const char*>(content)};
        xmlFree(content);
        return std::string{util::trim(out)};
    }

    bool inside(const xmlNode* node, const xmlNode* root) noexcept
    {
        for (; node != nullptr; node = node->parent) {
            if (node == root) {
                return true;
            }
        }
        return false;
    }

    /// How many elements carry this value as an ID (`ID`, `Id` or `id`); a signature is only
    /// believed when the element it names is the only one with that ID.
    std::size_t count_ids(xmlNode* node, const std::string& value)
    {
        std::size_t count = 0;
        for (; node != nullptr; node = node->next) {
            if (node->type != XML_ELEMENT_NODE) {
                continue;
            }
            for (const char* name: {"ID", "Id", "id"}) {
                count += attribute(node, name) == value ? 1U : 0U;
            }
            count += count_ids(node->children, value);
        }
        return count;
    }

    // ---- canonicalization and signatures -------------------------------------------------------

    struct Visibility
    {
        const xmlNode* root;     // only this subtree is part of the output
        const xmlNode* excluded; // ... except this one (the enveloped signature), may be null
    };

    int visible(void* user_data, xmlNode* node, xmlNode* parent)
    {
        const auto* rule = static_cast<const Visibility*>(user_data);
        // Namespace declarations and attributes belong to the element they are on.
        const xmlNode* owner =
            (node->type == XML_NAMESPACE_DECL || node->type == XML_ATTRIBUTE_NODE) ? parent : node;
        if (owner == nullptr || !inside(owner, rule->root)) {
            return 0;
        }
        if (rule->excluded != nullptr && inside(owner, rule->excluded)) {
            return 0;
        }
        return 1;
    }

    int write_callback(void* context, const char* buffer, int length)
    {
        static_cast<std::string*>(context)->append(buffer, static_cast<std::size_t>(length));
        return length;
    }

    int close_callback(void*)
    {
        return 0;
    }

    /// Exclusive canonical form (without comments) of `root`, leaving out `excluded`;
    /// `prefixes` are the InclusiveNamespaces PrefixList entries.
    Result<std::string> canonicalize(
        xmlDoc* doc,
        const xmlNode* root,
        const xmlNode* excluded,
        const std::vector<std::string>& prefixes
    )
    {
        std::string out;
        xmlOutputBuffer* buffer =
            xmlOutputBufferCreateIO(write_callback, close_callback, &out, nullptr);
        if (buffer == nullptr) {
            return failure("cannot canonicalize");
        }
        Visibility rule{root, excluded};
        std::vector<const xmlChar*> list;
        for (const std::string& prefix: prefixes) {
            list.push_back(reinterpret_cast<const xmlChar*>(prefix.c_str()));
        }
        list.push_back(nullptr);
        const int status = xmlC14NExecute(
            doc,
            visible,
            &rule,
            XML_C14N_EXCLUSIVE_1_0,
            prefixes.empty() ? nullptr : const_cast<xmlChar**>(list.data()),
            0,
            buffer
        );
        xmlOutputBufferClose(buffer);
        if (status < 0) {
            return failure("cannot canonicalize");
        }
        return out;
    }

    std::string strip_space(std::string_view text)
    {
        std::string out;
        for (const char letter: text) {
            if (std::isspace(static_cast<unsigned char>(letter)) == 0) {
                out.push_back(letter);
            }
        }
        return out;
    }

    const EVP_MD* digest_for(std::string_view algorithm)
    {
        if (algorithm == "http://www.w3.org/2001/04/xmlenc#sha256") {
            return EVP_sha256();
        }
        if (algorithm == "http://www.w3.org/2001/04/xmlenc#sha512") {
            return EVP_sha512();
        }
        return nullptr;
    }

    const EVP_MD* signature_hash_for(std::string_view algorithm)
    {
        if (algorithm == "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256") {
            return EVP_sha256();
        }
        if (algorithm == "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512") {
            return EVP_sha512();
        }
        return nullptr;
    }

    std::vector<std::string> inclusive_prefixes(xmlNode* method)
    {
        std::vector<std::string> out;
        xmlNode* list = child(method, ALG_EXC_C14N, "InclusiveNamespaces");
        if (list != nullptr) {
            for (const std::string& prefix: util::split(attribute(list, "PrefixList"), ' ')) {
                if (!prefix.empty() && prefix.size() < 64) {
                    out.push_back(prefix == "#default" ? std::string{} : prefix);
                }
            }
        }
        return out;
    }

    /// Verifies the enveloped `signature` that sits directly inside `target`: the single reference
    /// points at exactly `target` (whose ID occurs once), the digest of `target` without the
    /// signature matches, and the signature over SignedInfo verifies with the configured
    /// certificate.
    Result<void> verify_signature(
        xmlDoc* doc,
        xmlNode* target,
        xmlNode* signature,
        const std::string& certificate_pem
    )
    {
        if (signature->parent != target) {
            return failure("the signature is not directly inside the element it signs");
        }
        xmlNode* signed_info = child(signature, NS_DSIG, "SignedInfo");
        xmlNode* value_node = child(signature, NS_DSIG, "SignatureValue");
        if (signed_info == nullptr || value_node == nullptr ||
            count_children(signature, NS_DSIG, "SignedInfo") != 1 ||
            count_children(signature, NS_DSIG, "SignatureValue") != 1) {
            return failure("the signature is malformed");
        }
        xmlNode* c14n_method = child(signed_info, NS_DSIG, "CanonicalizationMethod");
        xmlNode* signature_method = child(signed_info, NS_DSIG, "SignatureMethod");
        if (c14n_method == nullptr || attribute(c14n_method, "Algorithm") != ALG_EXC_C14N ||
            signature_method == nullptr) {
            return failure("the signature uses a canonicalization that is not accepted");
        }
        const EVP_MD* hash = signature_hash_for(attribute(signature_method, "Algorithm"));
        if (hash == nullptr) {
            return failure("the signature algorithm is not accepted");
        }
        // One reference, to this element and no other.
        xmlNode* reference = child(signed_info, NS_DSIG, "Reference");
        if (reference == nullptr || count_children(signed_info, NS_DSIG, "Reference") != 1) {
            return failure("the signature must have exactly one reference");
        }
        const std::string id = attribute(target, "ID");
        if (id.empty() || attribute(reference, "URI") != "#" + id) {
            return failure("the signature does not cover this element");
        }
        if (count_ids(xmlDocGetRootElement(doc), id) != 1) {
            return failure("the ID of the signed element is not unique");
        }
        // Transforms: the enveloped signature and exclusive canonicalization, nothing else.
        bool enveloped = false;
        std::vector<std::string> prefixes;
        if (xmlNode* transforms = child(reference, NS_DSIG, "Transforms")) {
            for (xmlNode* at = transforms->children; at != nullptr; at = at->next) {
                if (at->type != XML_ELEMENT_NODE) {
                    continue;
                }
                const std::string algorithm = attribute(at, "Algorithm");
                if (!is_element(at, NS_DSIG, "Transform")) {
                    return failure("unexpected content in the transforms");
                }
                if (algorithm == ALG_ENVELOPED && !enveloped) {
                    enveloped = true;
                } else if (algorithm == ALG_EXC_C14N && prefixes.empty()) {
                    prefixes = inclusive_prefixes(at);
                } else if (algorithm != ALG_EXC_C14N) {
                    return failure("a transform that is not accepted");
                }
            }
        }
        if (!enveloped) {
            return failure("the signature is not an enveloped one");
        }
        xmlNode* digest_method = child(reference, NS_DSIG, "DigestMethod");
        xmlNode* digest_value = child(reference, NS_DSIG, "DigestValue");
        const EVP_MD* digest_hash =
            digest_method == nullptr ? nullptr : digest_for(attribute(digest_method, "Algorithm"));
        if (digest_hash == nullptr || digest_value == nullptr) {
            return failure("the digest algorithm is not accepted");
        }
        const auto canonical = canonicalize(doc, target, signature, prefixes);
        if (!canonical) {
            return failure(canonical.error());
        }
        std::string computed(EVP_MAX_MD_SIZE, '\0');
        unsigned int computed_size = 0;
        if (EVP_Digest(
                canonical->data(),
                canonical->size(),
                reinterpret_cast<unsigned char*>(computed.data()),
                &computed_size,
                digest_hash,
                nullptr
            ) != 1) {
            return failure("cannot compute the digest");
        }
        computed.resize(computed_size);
        const auto expected = util::base64_decode(strip_space(text_of(digest_value)));
        if (!expected || !util::constant_time_equals(*expected, computed)) {
            return failure("the digest of the signed element does not match");
        }
        // The signature over SignedInfo, with the configured certificate and nothing else.
        const auto signed_text =
            canonicalize(doc, signed_info, nullptr, inclusive_prefixes(c14n_method));
        const auto raw = util::base64_decode(strip_space(text_of(value_node)));
        if (!signed_text || !raw || raw->empty()) {
            return failure("the signature value is malformed");
        }
        std::unique_ptr<BIO, decltype(&BIO_free)> bio{
            BIO_new_mem_buf(certificate_pem.data(), static_cast<int>(certificate_pem.size())),
            &BIO_free
        };
        std::unique_ptr<X509, decltype(&X509_free)> certificate{
            bio ? PEM_read_bio_X509(bio.get(), nullptr, nullptr, nullptr) : nullptr,
            &X509_free
        };
        std::unique_ptr<EVP_PKEY, decltype(&EVP_PKEY_free)> key{
            certificate ? X509_get_pubkey(certificate.get()) : nullptr,
            &EVP_PKEY_free
        };
        if (key == nullptr || EVP_PKEY_id(key.get()) != EVP_PKEY_RSA ||
            EVP_PKEY_bits(key.get()) < 2'048) {
            return failure(
                "the identity provider's certificate is not an RSA one of 2048 bits or more"
            );
        }
        std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context{
            EVP_MD_CTX_new(),
            &EVP_MD_CTX_free
        };
        if (context == nullptr ||
            EVP_DigestVerifyInit(context.get(), nullptr, hash, nullptr, key.get()) != 1 ||
            EVP_DigestVerify(
                context.get(),
                reinterpret_cast<const std::uint8_t*>(raw->data()),
                raw->size(),
                reinterpret_cast<const std::uint8_t*>(signed_text->data()),
                signed_text->size()
            ) != 1) {
            return failure("the signature is wrong");
        }
        return {};
    }

} // namespace

std::optional<std::int64_t> parse_time(std::string_view stamp)
{
    // "2024-01-02T03:04:05Z", "2024-01-02T03:04:05.123Z"
    if (stamp.size() < 20 || stamp.back() != 'Z') {
        return std::nullopt;
    }
    std::string whole{stamp.substr(0, 19)};
    const std::string_view rest = stamp.substr(19, stamp.size() - 20);
    if (!rest.empty() && (rest.front() != '.' ||
                          rest.find_first_not_of("0123456789", 1) != std::string_view::npos)) {
        return std::nullopt;
    }
    std::tm moment{};
    const char* end = strptime(whole.c_str(), "%Y-%m-%dT%H:%M:%S", &moment);
    if (end == nullptr || *end != '\0') {
        return std::nullopt;
    }
    return static_cast<std::int64_t>(timegm(&moment));
}

Result<Assertion> validate_response(
    std::string_view xml,
    const Settings& settings,
    std::string_view request_id,
    std::int64_t now
)
{
    if (xml.empty() || xml.size() > MAX_XML || request_id.empty()) {
        return failure("the response is empty or too large");
    }
    // No DTD, no entities: nothing in the document can name a file, a URL or a bomb.
    if (xml.find("<!DOCTYPE") != std::string_view::npos ||
        xml.find("<!ENTITY") != std::string_view::npos) {
        return failure("the response contains a DTD");
    }
    Doc doc{xmlReadMemory(
        xml.data(),
        static_cast<int>(xml.size()),
        nullptr,
        nullptr,
        XML_PARSE_NONET | XML_PARSE_NOERROR | XML_PARSE_NOWARNING | XML_PARSE_NO_XXE |
            XML_PARSE_NOBLANKS
    )};
    if (doc == nullptr || doc->intSubset != nullptr || doc->extSubset != nullptr) {
        return failure("the response is not well formed XML");
    }
    xmlNode* response = xmlDocGetRootElement(doc.get());
    if (!is_element(response, NS_PROTOCOL, "Response")) {
        return failure("not a SAML response");
    }
    // Success, and an answer to the request this server made.
    xmlNode* status = child(response, NS_PROTOCOL, "Status");
    xmlNode* code = child(status, NS_PROTOCOL, "StatusCode");
    if (code == nullptr || attribute(code, "Value") != SUCCESS) {
        return failure("the identity provider did not report success");
    }
    if (attribute(response, "InResponseTo") != request_id) {
        return failure("the response answers another request");
    }
    if (const std::string destination = attribute(response, "Destination");
        !destination.empty() && destination != settings.acs_url) {
        return failure("the response is for another service provider endpoint");
    }
    if (xmlNode* issuer = child(response, NS_ASSERTION, "Issuer");
        issuer != nullptr && text_of(issuer) != settings.idp_entity_id) {
        return failure("the response is from another identity provider");
    }
    if (child(response, NS_ASSERTION, "EncryptedAssertion") != nullptr) {
        return failure("encrypted assertions are not supported");
    }
    if (count_children(response, NS_ASSERTION, "Assertion") != 1) {
        return failure("the response must contain exactly one assertion");
    }
    xmlNode* assertion = child(response, NS_ASSERTION, "Assertion");

    // The assertion must be covered by a valid signature: its own, or its Response's.
    bool signed_ok = false;
    std::string why = "the assertion is not signed";
    for (xmlNode* target: {assertion, response}) {
        for (xmlNode* at = target->children; at != nullptr; at = at->next) {
            if (is_element(at, NS_DSIG, "Signature")) {
                const auto verified =
                    verify_signature(doc.get(), target, at, settings.idp_certificate_pem);
                if (verified) {
                    signed_ok = true;
                } else {
                    why = verified.error();
                }
            }
        }
        if (signed_ok) {
            break;
        }
    }
    if (!signed_ok) {
        return failure(why);
    }

    // What the assertion says.
    if (text_of(child(assertion, NS_ASSERTION, "Issuer")) != settings.idp_entity_id) {
        return failure("the assertion is from another identity provider");
    }
    Assertion out;
    out.id = attribute(assertion, "ID");
    xmlNode* subject = child(assertion, NS_ASSERTION, "Subject");
    xmlNode* name_id = child(subject, NS_ASSERTION, "NameID");
    if (name_id == nullptr || text_of(name_id).empty() || text_of(name_id).size() > 256) {
        return failure("the assertion names no one");
    }
    out.name_id = text_of(name_id);
    bool confirmed = false;
    std::int64_t window_end = 0;
    for (xmlNode* at = subject->children; at != nullptr; at = at->next) {
        if (!is_element(at, NS_ASSERTION, "SubjectConfirmation") ||
            attribute(at, "Method") != BEARER) {
            continue;
        }
        xmlNode* data = child(at, NS_ASSERTION, "SubjectConfirmationData");
        const auto until =
            data == nullptr ? std::nullopt : parse_time(attribute(data, "NotOnOrAfter"));
        if (data != nullptr && until && attribute(data, "Recipient") == settings.acs_url &&
            attribute(data, "InResponseTo") == request_id && *until + settings.skew_seconds > now) {
            confirmed = true;
            window_end = *until;
        }
    }
    if (!confirmed) {
        return failure("the assertion is not a bearer confirmation for this request");
    }
    out.not_on_or_after = window_end;
    xmlNode* conditions = child(assertion, NS_ASSERTION, "Conditions");
    if (conditions == nullptr) {
        return failure("the assertion has no conditions");
    }
    const auto not_before = parse_time(attribute(conditions, "NotBefore"));
    const auto not_after = parse_time(attribute(conditions, "NotOnOrAfter"));
    if (!not_after || *not_after + settings.skew_seconds <= now ||
        (not_before && *not_before - settings.skew_seconds > now)) {
        return failure("the assertion is not valid at this time");
    }
    out.not_on_or_after = std::min(out.not_on_or_after, *not_after);
    bool audience_ok = false;
    for (xmlNode* at = conditions->children; at != nullptr; at = at->next) {
        if (!is_element(at, NS_ASSERTION, "AudienceRestriction")) {
            continue;
        }
        bool this_ok = false;
        for (xmlNode* audience = at->children; audience != nullptr; audience = audience->next) {
            this_ok = this_ok || (is_element(audience, NS_ASSERTION, "Audience") &&
                                  text_of(audience) == settings.sp_entity_id);
        }
        if (!this_ok) {
            return failure("the assertion is for another audience");
        }
        audience_ok = true;
    }
    if (!audience_ok) {
        return failure("the assertion names no audience");
    }
    if (xmlNode* statement = child(assertion, NS_ASSERTION, "AttributeStatement")) {
        for (xmlNode* at = statement->children; at != nullptr; at = at->next) {
            if (!is_element(at, NS_ASSERTION, "Attribute")) {
                continue;
            }
            const std::string name = attribute(at, "Name");
            for (xmlNode* value = at->children; value != nullptr; value = value->next) {
                if (is_element(value, NS_ASSERTION, "AttributeValue") &&
                    out.attributes.size() < 64 && !name.empty()) {
                    out.attributes[name].push_back(text_of(value));
                }
            }
        }
    }
    return out;
}

std::string build_authn_request(
    const Settings& settings,
    std::string_view request_id,
    std::string_view destination,
    std::int64_t now
)
{
    std::tm moment{};
    const std::time_t seconds = static_cast<std::time_t>(now);
    gmtime_r(&seconds, &moment);
    char stamp[32];
    std::strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%SZ", &moment);
    return R"(<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" )"
           R"(xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID=")" +
           util::xml_escape(request_id) + R"(" Version="2.0" IssueInstant=")" + stamp +
           R"(" Destination=")" + util::xml_escape(destination) +
           R"(" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" )"
           R"(AssertionConsumerServiceURL=")" +
           util::xml_escape(settings.acs_url) + R"("><saml:Issuer>)" +
           util::xml_escape(settings.sp_entity_id) +
           R"(</saml:Issuer><samlp:NameIDPolicy AllowCreate="true"/></samlp:AuthnRequest>)";
}

std::string redirect_url(
    std::string_view destination,
    std::string_view authn_request_xml,
    std::string_view relay_state
)
{
    // Raw DEFLATE (no zlib header), as the HTTP-Redirect binding says.
    z_stream stream{};
    deflateInit2(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, -15, 8, Z_DEFAULT_STRATEGY);
    std::string packed(deflateBound(&stream, authn_request_xml.size()) + 16, '\0');
    stream.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(authn_request_xml.data()));
    stream.avail_in = static_cast<uInt>(authn_request_xml.size());
    stream.next_out = reinterpret_cast<Bytef*>(packed.data());
    stream.avail_out = static_cast<uInt>(packed.size());
    deflate(&stream, Z_FINISH);
    packed.resize(stream.total_out);
    deflateEnd(&stream);
    std::string url{destination};
    url += url.find('?') == std::string::npos ? '?' : '&';
    std::vector<std::pair<std::string, std::string>> query{
        {"SAMLRequest", util::base64_encode(packed)}
    };
    if (!relay_state.empty()) {
        query.emplace_back("RelayState", std::string{relay_state});
    }
    return url + util::form_encode(query);
}

std::string metadata(const Settings& settings)
{
    return R"(<?xml version="1.0"?><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID=")" +
           util::xml_escape(settings.sp_entity_id) +
           R"("><md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" )"
           R"(protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">)"
           R"(<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location=")" +
           util::xml_escape(settings.acs_url) +
           R"(" index="0" isDefault="true"/></md:SPSSODescriptor></md:EntityDescriptor>)";
}

} // namespace nc::saml
