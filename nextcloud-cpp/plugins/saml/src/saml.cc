#include "saml.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstring>
#include <ctime>
#include <libxml/c14n.h>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <libxml/xmlIO.h>
#include <memory>
#include <openssl/aead.h>
#include <openssl/bio.h>
#include <openssl/bn.h>
#include <openssl/cipher.h>
#include <openssl/ec.h>
#include <openssl/ec_key.h>
#include <openssl/ecdsa.h>
#include <openssl/evp.h>
#include <openssl/mem.h>
#include <openssl/nid.h>
#include <openssl/pem.h>
#include <openssl/rsa.h>
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
    constexpr std::int64_t MAX_LOGOUT_AGE = 600; // a logout request older than this is not current

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

    /// What a SignatureMethod stands for: the hash, and whether the key is an ECDSA one (the
    /// signature value is then the two numbers r and s side by side, not a DER sequence).
    struct SignatureKind
    {
        const EVP_MD* hash{nullptr};
        bool ecdsa{false};
    };

    SignatureKind signature_kind_for(std::string_view algorithm)
    {
        constexpr std::string_view MORE = "http://www.w3.org/2001/04/xmldsig-more#";
        if (!algorithm.starts_with(MORE)) {
            return {};
        }
        const std::string_view name = algorithm.substr(MORE.size());
        if (name == "rsa-sha256") {
            return {EVP_sha256(), false};
        }
        if (name == "rsa-sha384") {
            return {EVP_sha384(), false};
        }
        if (name == "rsa-sha512") {
            return {EVP_sha512(), false};
        }
        if (name == "ecdsa-sha256") {
            return {EVP_sha256(), true};
        }
        if (name == "ecdsa-sha384") {
            return {EVP_sha384(), true};
        }
        if (name == "ecdsa-sha512") {
            return {EVP_sha512(), true};
        }
        return {};
    }

    /// The signature value of an ECDSA signature in XML-DSig (r and s, each as wide as the curve's
    /// order, one after the other) as the DER sequence BoringSSL checks; empty when it is not that.
    std::string ecdsa_der_from_xmldsig(const EVP_PKEY* key, std::string_view raw)
    {
        const EC_KEY* ec = EVP_PKEY_get0_EC_KEY(key);
        const std::size_t width =
            (EC_GROUP_get_degree(EC_KEY_get0_group(ec)) + 7) / 8; // bytes of r and of s
        if (raw.size() != 2 * width) {
            return {};
        }
        const std::unique_ptr<ECDSA_SIG, decltype(&ECDSA_SIG_free)> signature{
            ECDSA_SIG_new(),
            &ECDSA_SIG_free
        };
        if (signature == nullptr ||
            BN_bin2bn(reinterpret_cast<const std::uint8_t*>(raw.data()), width, signature->r) ==
                nullptr ||
            BN_bin2bn(
                reinterpret_cast<const std::uint8_t*>(raw.data()) + width,
                width,
                signature->s
            ) == nullptr) {
            return {};
        }
        std::uint8_t* der = nullptr;
        std::size_t length = 0;
        if (ECDSA_SIG_to_bytes(&der, &length, signature.get()) != 1) {
            return {};
        }
        std::string out{reinterpret_cast<const char*>(der), length};
        OPENSSL_free(der);
        return out;
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

    /// Checks that `raw` is the signature of the identity provider's certificate (not the key the
    /// message names) over `signed_text` with the algorithm `kind`.
    Result<void> check_signature(
        const std::string& certificate_pem,
        const SignatureKind& kind,
        std::string_view raw,
        std::string_view signed_text
    )
    {
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
        // The algorithm the message names has to be the one of the configured key: the key decides,
        // the message does not.
        const bool key_is_rsa = key != nullptr && EVP_PKEY_id(key.get()) == EVP_PKEY_RSA;
        const bool key_is_ec = key != nullptr && EVP_PKEY_id(key.get()) == EVP_PKEY_EC;
        if (key_is_ec) {
            const int curve =
                EC_GROUP_get_curve_name(EC_KEY_get0_group(EVP_PKEY_get0_EC_KEY(key.get())));
            if (curve != NID_X9_62_prime256v1 && curve != NID_secp384r1 && curve != NID_secp521r1) {
                return failure("the identity provider's certificate has an unaccepted curve");
            }
        }
        if (!(key_is_rsa && !kind.ecdsa && EVP_PKEY_bits(key.get()) >= 2'048) &&
            !(key_is_ec && kind.ecdsa)) {
            return failure(
                "the identity provider's certificate is not an RSA key of 2048 bits or more, or an "
                "elliptic curve key (P-256, P-384, P-521) matching the signature algorithm"
            );
        }
        std::string converted;
        if (kind.ecdsa) {
            converted = ecdsa_der_from_xmldsig(key.get(), raw);
            if (converted.empty()) {
                return failure("the signature value is malformed");
            }
        }
        const std::string_view signature_bytes = kind.ecdsa ? std::string_view{converted} : raw;
        std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context{
            EVP_MD_CTX_new(),
            &EVP_MD_CTX_free
        };
        if (context == nullptr ||
            EVP_DigestVerifyInit(context.get(), nullptr, kind.hash, nullptr, key.get()) != 1 ||
            EVP_DigestVerify(
                context.get(),
                reinterpret_cast<const std::uint8_t*>(signature_bytes.data()),
                signature_bytes.size(),
                reinterpret_cast<const std::uint8_t*>(signed_text.data()),
                signed_text.size()
            ) != 1) {
            return failure("the signature is wrong");
        }
        return {};
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
        const SignatureKind kind = signature_kind_for(attribute(signature_method, "Algorithm"));
        const EVP_MD* hash = kind.hash;
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
        return check_signature(certificate_pem, kind, *raw, *signed_text);
    }

    /// The base64 between the lines of a PEM certificate, on one line.
    std::string pem_body(std::string_view pem)
    {
        std::string out;
        bool inside = false;
        for (const std::string& line: util::split(pem, '\n')) {
            const std::string_view text = util::trim(line);
            if (text.starts_with("-----BEGIN")) {
                inside = true;
            } else if (text.starts_with("-----END")) {
                break;
            } else if (inside) {
                out += text;
            }
        }
        return out;
    }

    /// A `KeyDescriptor` for what the certificate is used for.
    std::string key_descriptor(std::string_view use, std::string_view certificate_pem)
    {
        return R"(<md:KeyDescriptor use=")" + std::string{use} +
               R"("><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data>)"
               R"(<ds:X509Certificate>)" +
               pem_body(certificate_pem) +
               R"(</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>)";
    }

    constexpr std::string_view ALG_RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";

    using Pkey = std::unique_ptr<EVP_PKEY, decltype(&EVP_PKEY_free)>;

    /// The RSA private key in a PEM text; empty when it is not one.
    Pkey load_rsa_key(std::string_view pem)
    {
        const std::unique_ptr<BIO, decltype(&BIO_free)> bio{
            BIO_new_mem_buf(pem.data(), static_cast<int>(pem.size())),
            &BIO_free
        };
        Pkey key{
            bio == nullptr ? nullptr
                           : PEM_read_bio_PrivateKey(bio.get(), nullptr, nullptr, nullptr),
            &EVP_PKEY_free
        };
        if (key != nullptr && EVP_PKEY_id(key.get()) != EVP_PKEY_RSA) {
            key.reset();
        }
        return key;
    }

    /// RSA PKCS#1 v1.5 signature with SHA-256 of `data` by the PEM key, base64 encoded; empty when
    /// the key cannot sign.
    std::string sign_rsa_sha256(std::string_view key_pem, std::string_view data)
    {
        const Pkey key = load_rsa_key(key_pem);
        if (key == nullptr) {
            return {};
        }
        const std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context{
            EVP_MD_CTX_new(),
            &EVP_MD_CTX_free
        };
        std::size_t size = 0;
        if (context == nullptr ||
            EVP_DigestSignInit(context.get(), nullptr, EVP_sha256(), nullptr, key.get()) != 1 ||
            EVP_DigestSignUpdate(context.get(), data.data(), data.size()) != 1 ||
            EVP_DigestSignFinal(context.get(), nullptr, &size) != 1) {
            return {};
        }
        std::string signature(size, '\0');
        if (EVP_DigestSignFinal(
                context.get(),
                reinterpret_cast<unsigned char*>(signature.data()),
                &size
            ) != 1) {
            return {};
        }
        signature.resize(size);
        return util::base64_encode(signature);
    }

    constexpr std::string_view NS_XENC = "http://www.w3.org/2001/04/xmlenc#";
    constexpr std::string_view NS_XENC11 = "http://www.w3.org/2009/xmlenc11#";

    /// The bytes in the `CipherData/CipherValue` below `parent`.
    Result<std::string> cipher_bytes(xmlNode* parent)
    {
        xmlNode* value = child(child(parent, NS_XENC, "CipherData"), NS_XENC, "CipherValue");
        if (value == nullptr) {
            return failure("the encrypted data has no cipher value");
        }
        std::string compact;
        for (const char letter: text_of(value)) {
            if (std::isspace(static_cast<unsigned char>(letter)) == 0) {
                compact.push_back(letter);
            }
        }
        auto bytes = util::base64_decode(compact);
        if (!bytes || bytes->empty() || bytes->size() > MAX_XML) {
            return failure("the cipher value is not base64");
        }
        return *std::move(bytes);
    }

    const EVP_MD* oaep_digest_for(std::string_view algorithm)
    {
        if (algorithm == "http://www.w3.org/2000/09/xmldsig#sha1") {
            return EVP_sha1();
        }
        if (algorithm == "http://www.w3.org/2001/04/xmlenc#sha256") {
            return EVP_sha256();
        }
        if (algorithm == "http://www.w3.org/2001/04/xmldsig-more#sha384") {
            return EVP_sha384();
        }
        if (algorithm == "http://www.w3.org/2001/04/xmlenc#sha512") {
            return EVP_sha512();
        }
        return nullptr;
    }

    const EVP_MD* mgf1_digest_for(std::string_view algorithm)
    {
        if (algorithm == "http://www.w3.org/2009/xmlenc11#mgf1sha1") {
            return EVP_sha1();
        }
        if (algorithm == "http://www.w3.org/2009/xmlenc11#mgf1sha256") {
            return EVP_sha256();
        }
        if (algorithm == "http://www.w3.org/2009/xmlenc11#mgf1sha384") {
            return EVP_sha384();
        }
        if (algorithm == "http://www.w3.org/2009/xmlenc11#mgf1sha512") {
            return EVP_sha512();
        }
        return nullptr;
    }

    /// The session key out of an `EncryptedKey`: RSA-OAEP only. (PKCS#1 v1.5 key transport can be
    /// attacked through the answers it gives, and every identity provider can do OAEP.)
    Result<std::string> unwrap_key(EVP_PKEY* key, xmlNode* encrypted_key)
    {
        xmlNode* method = child(encrypted_key, NS_XENC, "EncryptionMethod");
        const std::string algorithm = attribute(method, "Algorithm");
        const EVP_MD* oaep = EVP_sha1();
        const EVP_MD* mgf1 = EVP_sha1();
        if (algorithm != "http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p" &&
            algorithm != "http://www.w3.org/2009/xmlenc11#rsa-oaep") {
            return failure("the key transport algorithm is not accepted");
        }
        if (xmlNode* digest = child(method, NS_DSIG, "DigestMethod"); digest != nullptr) {
            oaep = oaep_digest_for(attribute(digest, "Algorithm"));
        }
        if (xmlNode* generator = child(method, NS_XENC11, "MGF"); generator != nullptr) {
            mgf1 = mgf1_digest_for(attribute(generator, "Algorithm"));
        }
        if (oaep == nullptr || mgf1 == nullptr) {
            return failure("the key transport digest is not accepted");
        }
        const auto wrapped = cipher_bytes(encrypted_key);
        if (!wrapped) {
            return failure(wrapped.error());
        }
        const std::unique_ptr<EVP_PKEY_CTX, decltype(&EVP_PKEY_CTX_free)> context{
            EVP_PKEY_CTX_new(key, nullptr),
            &EVP_PKEY_CTX_free
        };
        std::size_t size = 0;
        const auto* in = reinterpret_cast<const unsigned char*>(wrapped->data());
        if (context == nullptr || EVP_PKEY_decrypt_init(context.get()) != 1 ||
            EVP_PKEY_CTX_set_rsa_padding(context.get(), RSA_PKCS1_OAEP_PADDING) != 1 ||
            EVP_PKEY_CTX_set_rsa_oaep_md(context.get(), oaep) != 1 ||
            EVP_PKEY_CTX_set_rsa_mgf1_md(context.get(), mgf1) != 1 ||
            EVP_PKEY_decrypt(context.get(), nullptr, &size, in, wrapped->size()) != 1) {
            return failure("the session key cannot be unwrapped");
        }
        std::string session(size, '\0');
        if (EVP_PKEY_decrypt(
                context.get(),
                reinterpret_cast<unsigned char*>(session.data()),
                &size,
                in,
                wrapped->size()
            ) != 1) {
            return failure("the session key cannot be unwrapped");
        }
        session.resize(size);
        return session;
    }

    /// The plain text of XML Encryption data: AES-CBC (the IV in front, XML padding at the end) or
    /// AES-GCM (the 12 byte IV in front, the 16 byte tag at the end).
    Result<std::string>
    decrypt_data(std::string_view algorithm, std::string_view session_key, std::string_view data)
    {
        struct Cbc
        {
            std::string_view name;
            std::size_t key_size;
            const EVP_CIPHER* (*cipher)();
        };

        static const Cbc CBC[] = {
            {"http://www.w3.org/2001/04/xmlenc#aes128-cbc", 16, &EVP_aes_128_cbc},
            {"http://www.w3.org/2001/04/xmlenc#aes192-cbc", 24, &EVP_aes_192_cbc},
            {"http://www.w3.org/2001/04/xmlenc#aes256-cbc", 32, &EVP_aes_256_cbc}
        };
        const auto* key = reinterpret_cast<const unsigned char*>(session_key.data());
        for (const Cbc& mode: CBC) {
            if (mode.name != algorithm) {
                continue;
            }
            if (session_key.size() != mode.key_size || data.size() < 32 || data.size() % 16 != 0) {
                return failure("the encrypted data is malformed");
            }
            const std::unique_ptr<EVP_CIPHER_CTX, decltype(&EVP_CIPHER_CTX_free)> context{
                EVP_CIPHER_CTX_new(),
                &EVP_CIPHER_CTX_free
            };
            const auto* iv = reinterpret_cast<const unsigned char*>(data.data());
            const std::string_view body = data.substr(16);
            std::string plain(body.size() + 16, '\0');
            int written = 0;
            int finished = 0;
            if (context == nullptr ||
                EVP_DecryptInit_ex(context.get(), mode.cipher(), nullptr, key, iv) != 1 ||
                EVP_CIPHER_CTX_set_padding(context.get(), 0) != 1 ||
                EVP_DecryptUpdate(
                    context.get(),
                    reinterpret_cast<unsigned char*>(plain.data()),
                    &written,
                    reinterpret_cast<const unsigned char*>(body.data()),
                    static_cast<int>(body.size())
                ) != 1 ||
                EVP_DecryptFinal_ex(
                    context.get(),
                    reinterpret_cast<unsigned char*>(plain.data()) + written,
                    &finished
                ) != 1) {
                return failure("the encrypted data cannot be decrypted");
            }
            plain.resize(static_cast<std::size_t>(written + finished));
            // XML Encryption pads with arbitrary bytes and a last byte that counts them.
            const std::size_t padding =
                plain.empty() ? 0 : static_cast<unsigned char>(plain.back());
            if (padding < 1 || padding > 16 || padding > plain.size()) {
                return failure("the encrypted data cannot be decrypted");
            }
            plain.resize(plain.size() - padding);
            return plain;
        }
        const EVP_AEAD* aead = nullptr;
        if (algorithm == "http://www.w3.org/2009/xmlenc11#aes128-gcm" && session_key.size() == 16) {
            aead = EVP_aead_aes_128_gcm();
        } else if (algorithm == "http://www.w3.org/2009/xmlenc11#aes256-gcm" &&
                   session_key.size() == 32) {
            aead = EVP_aead_aes_256_gcm();
        }
        if (aead == nullptr) {
            return failure("the encryption algorithm is not accepted");
        }
        if (data.size() < 12 + 16) {
            return failure("the encrypted data is malformed");
        }
        EVP_AEAD_CTX context;
        EVP_AEAD_CTX_zero(&context);
        if (EVP_AEAD_CTX_init(&context, aead, key, session_key.size(), 16, nullptr) != 1) {
            return failure("the encrypted data cannot be decrypted");
        }
        std::string plain(data.size() - 12 - 16, '\0');
        std::size_t length = 0;
        const bool opened = EVP_AEAD_CTX_open(
                                &context,
                                reinterpret_cast<unsigned char*>(plain.data()),
                                &length,
                                plain.size(),
                                reinterpret_cast<const unsigned char*>(data.data()),
                                12,
                                reinterpret_cast<const unsigned char*>(data.data()) + 12,
                                data.size() - 12,
                                nullptr,
                                0
                            ) == 1;
        EVP_AEAD_CTX_cleanup(&context);
        if (!opened) {
            return failure("the encrypted data cannot be decrypted");
        }
        plain.resize(length);
        return plain;
    }

    /// The assertion inside an `EncryptedAssertion`, decrypted with the service's RSA key. The
    /// session key is in the `EncryptedKey` inside the data's `KeyInfo`, or next to the data.
    Result<std::string> decrypt_assertion(xmlNode* encrypted, std::string_view key_pem)
    {
        if (count_children(encrypted, NS_XENC, "EncryptedData") != 1) {
            return failure("the encrypted assertion must hold exactly one encrypted element");
        }
        xmlNode* data = child(encrypted, NS_XENC, "EncryptedData");
        if (attribute(data, "Type") != "http://www.w3.org/2001/04/xmlenc#Element") {
            return failure("the encrypted data is not an element");
        }
        const Pkey key = load_rsa_key(key_pem);
        if (key == nullptr) {
            return failure("there is no private key to decrypt with");
        }
        xmlNode* encrypted_key = child(child(data, NS_DSIG, "KeyInfo"), NS_XENC, "EncryptedKey");
        if (encrypted_key == nullptr) {
            encrypted_key = child(encrypted, NS_XENC, "EncryptedKey");
        }
        if (encrypted_key == nullptr) {
            return failure("the encrypted assertion carries no key");
        }
        const auto session = unwrap_key(key.get(), encrypted_key);
        if (!session) {
            return failure(session.error());
        }
        const auto bytes = cipher_bytes(data);
        if (!bytes) {
            return failure(bytes.error());
        }
        auto plain = decrypt_data(
            attribute(child(data, NS_XENC, "EncryptionMethod"), "Algorithm"),
            *session,
            *bytes
        );
        if (!plain) {
            return failure(plain.error());
        }
        return plain;
    }

    /// Reads a message of the identity provider: no DTD, no entities (nothing in the document can
    /// name a file, a URL or a bomb), size limited. nullptr with `why` set when it is not
    /// acceptable.
    Doc parse_message(std::string_view xml, std::string& why)
    {
        if (xml.empty() || xml.size() > MAX_XML) {
            why = "the response is empty or too large";
            return nullptr;
        }
        if (xml.find("<!DOCTYPE") != std::string_view::npos ||
            xml.find("<!ENTITY") != std::string_view::npos) {
            why = "the response contains a DTD";
            return nullptr;
        }
        Doc doc{xmlReadMemory(
            xml.data(),
            static_cast<int>(xml.size()),
            nullptr,
            nullptr,
            // The white space between elements stays: the identity provider signed it with the
            // rest (a pretty printed response is signed as it is printed), and dropping it would
            // change what is digested.
            XML_PARSE_NONET | XML_PARSE_NOERROR | XML_PARSE_NOWARNING | XML_PARSE_NO_XXE
        )};
        if (doc == nullptr || doc->intSubset != nullptr || doc->extSubset != nullptr) {
            why = "the response is not well formed XML";
            return nullptr;
        }
        return doc;
    }

    std::string time_stamp(std::int64_t seconds)
    {
        std::tm moment{};
        const std::time_t value = static_cast<std::time_t>(seconds);
        gmtime_r(&value, &moment);
        char stamp[32];
        std::strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%SZ", &moment);
        return stamp;
    }

    /// The XML signature directly inside `message` that verifies with the configured certificate.
    Result<void> verify_own_signature(Doc& doc, xmlNode* message, const Settings& settings)
    {
        std::string why = "the message is not signed";
        for (xmlNode* at = message->children; at != nullptr; at = at->next) {
            if (is_element(at, NS_DSIG, "Signature")) {
                const auto verified =
                    verify_signature(doc.get(), message, at, settings.idp_certificate_pem);
                if (verified) {
                    return {};
                }
                why = verified.error();
            }
        }
        return failure(why);
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
    if (request_id.empty()) {
        return failure("the response is empty or too large");
    }
    std::string problem;
    Doc doc = parse_message(xml, problem);
    if (doc == nullptr) {
        return failure(problem);
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
    // One assertion: in the clear, or encrypted to this service's key.
    const std::size_t plain_count = count_children(response, NS_ASSERTION, "Assertion");
    const std::size_t encrypted_count =
        count_children(response, NS_ASSERTION, "EncryptedAssertion");
    if (plain_count + encrypted_count != 1) {
        return failure("the response must contain exactly one assertion");
    }
    xmlNode* assertion = nullptr;
    Doc decrypted; // the assertion of an encrypted one lives in a document of its own
    xmlDoc* assertion_owner = doc.get();
    if (encrypted_count == 1) {
        if (settings.sp_private_key_pem.empty()) {
            return failure("encrypted assertions need the key of this service (sp_private_key_file)"
            );
        }
        const auto plain = decrypt_assertion(
            child(response, NS_ASSERTION, "EncryptedAssertion"),
            settings.sp_private_key_pem
        );
        if (!plain) {
            return failure(plain.error());
        }
        std::string inner_problem;
        decrypted = parse_message(*plain, inner_problem);
        if (decrypted == nullptr) {
            return failure("the decrypted assertion is not acceptable: " + inner_problem);
        }
        assertion = xmlDocGetRootElement(decrypted.get());
        if (!is_element(assertion, NS_ASSERTION, "Assertion")) {
            return failure("the encrypted element is not an assertion");
        }
        assertion_owner = decrypted.get();
    } else {
        assertion = child(response, NS_ASSERTION, "Assertion");
    }

    // The assertion must be covered by a valid signature: its own, or its Response's (which, for an
    // encrypted assertion, covers the cipher text: only the identity provider can have made it).
    struct Target
    {
        xmlNode* node;
        xmlDoc* owner;
    };

    bool signed_ok = false;
    std::string why = "the assertion is not signed";
    for (const Target& target: {Target{assertion, assertion_owner}, Target{response, doc.get()}}) {
        for (xmlNode* at = target.node->children; at != nullptr; at = at->next) {
            if (is_element(at, NS_DSIG, "Signature")) {
                const auto verified =
                    verify_signature(target.owner, target.node, at, settings.idp_certificate_pem);
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

Result<std::string> open_redirect_message(
    std::string_view raw_query,
    std::string_view parameter,
    const Settings& settings
)
{
    // The pieces as sent: the signature covers their escaped text, in this order.
    struct Piece
    {
        std::string value{};
        bool seen{false};
    };

    Piece message;
    Piece relay;
    Piece algorithm;
    Piece signature;
    for (const std::string& text: util::split(raw_query, '&')) {
        const std::size_t equals = text.find('=');
        const std::string_view name = std::string_view{text}.substr(0, equals);
        Piece* target = name == parameter      ? &message
                        : name == "RelayState" ? &relay
                        : name == "SigAlg"     ? &algorithm
                        : name == "Signature"  ? &signature
                                               : nullptr;
        if (target == nullptr) {
            continue;
        }
        if (target->seen) {
            return failure("a parameter of the message is repeated");
        }
        target->seen = true;
        target->value = equals == std::string::npos ? std::string{} : text.substr(equals + 1);
    }
    if (message.value.empty() || algorithm.value.empty() || signature.value.empty()) {
        return failure("the message is not signed");
    }
    std::string signed_text{parameter};
    signed_text += "=" + std::string{message.value};
    if (relay.seen) {
        signed_text += "&RelayState=" + std::string{relay.value};
    }
    signed_text += "&SigAlg=" + std::string{algorithm.value};
    const SignatureKind kind = signature_kind_for(util::url_decode(algorithm.value));
    const auto raw = util::base64_decode(util::url_decode(signature.value));
    if (kind.hash == nullptr || !raw || raw->empty()) {
        return failure("the signature algorithm is not accepted");
    }
    if (const auto checked = check_signature(settings.idp_certificate_pem, kind, *raw, signed_text);
        !checked) {
        return failure(checked.error());
    }
    const auto packed = util::base64_decode(util::url_decode(message.value));
    if (!packed || packed->empty()) {
        return failure("the message is not valid");
    }
    // Raw DEFLATE; the size is capped so that a small message cannot grow without bound.
    constexpr std::size_t MAX_INFLATED = 256U * 1'024U;
    z_stream stream{};
    if (inflateInit2(&stream, -15) != Z_OK) {
        return failure("the message cannot be read");
    }
    stream.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(packed->data()));
    stream.avail_in = static_cast<uInt>(packed->size());
    std::string out;
    std::array<char, 16'384> buffer{};
    int status = Z_OK;
    while (status == Z_OK) {
        stream.next_out = reinterpret_cast<Bytef*>(buffer.data());
        stream.avail_out = static_cast<uInt>(buffer.size());
        status = inflate(&stream, Z_NO_FLUSH);
        out.append(buffer.data(), buffer.size() - stream.avail_out);
        if (out.size() > MAX_INFLATED) {
            inflateEnd(&stream);
            return failure("the message is too large");
        }
    }
    inflateEnd(&stream);
    if (status != Z_STREAM_END) {
        return failure("the message cannot be read");
    }
    return out;
}

Result<LogoutRequest> validate_logout_request(
    std::string_view xml,
    const Settings& settings,
    std::int64_t now,
    bool signed_outside
)
{
    std::string problem;
    Doc doc = parse_message(xml, problem);
    if (doc == nullptr) {
        return failure(problem);
    }
    xmlNode* request = xmlDocGetRootElement(doc.get());
    if (!is_element(request, NS_PROTOCOL, "LogoutRequest")) {
        return failure("not a SAML logout request");
    }
    // Only the identity provider may end sessions, so the message has to be signed by it (inside,
    // or around it, in the query of the redirect binding).
    if (!signed_outside) {
        if (const auto signature = verify_own_signature(doc, request, settings); !signature) {
            return failure(signature.error());
        }
    }
    if (text_of(child(request, NS_ASSERTION, "Issuer")) != settings.idp_entity_id) {
        return failure("the logout request is from another identity provider");
    }
    if (const std::string destination = attribute(request, "Destination");
        !settings.slo_url.empty() && destination != settings.slo_url) {
        return failure("the logout request is for another service provider endpoint");
    }
    if (const std::string until = attribute(request, "NotOnOrAfter"); !until.empty()) {
        const auto limit = parse_time(until);
        if (!limit || *limit + settings.skew_seconds <= now) {
            return failure("the logout request has expired");
        }
    }
    const auto issued = parse_time(attribute(request, "IssueInstant"));
    if (!issued || *issued - settings.skew_seconds > now ||
        *issued + MAX_LOGOUT_AGE + settings.skew_seconds < now) {
        return failure("the logout request is not current");
    }
    if (child(request, NS_ASSERTION, "EncryptedID") != nullptr) {
        return failure("encrypted names are not supported");
    }
    if (count_children(request, NS_ASSERTION, "NameID") != 1) {
        return failure("the logout request must name exactly one person");
    }
    LogoutRequest out;
    out.id = attribute(request, "ID");
    out.name_id = text_of(child(request, NS_ASSERTION, "NameID"));
    if (out.id.empty() || out.name_id.empty() || out.name_id.size() > 256) {
        return failure("the logout request names no one");
    }
    out.issued_at = *issued;
    return out;
}

std::string build_logout_request(
    const Settings& settings,
    std::string_view request_id,
    std::string_view destination,
    std::string_view name_id,
    std::int64_t now
)
{
    return R"(<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" )"
           R"(xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID=")" +
           util::xml_escape(request_id) + R"(" Version="2.0" IssueInstant=")" + time_stamp(now) +
           R"(" Destination=")" + util::xml_escape(destination) + R"("><saml:Issuer>)" +
           util::xml_escape(settings.sp_entity_id) + R"(</saml:Issuer><saml:NameID>)" +
           util::xml_escape(name_id) + R"(</saml:NameID></samlp:LogoutRequest>)";
}

std::string build_logout_response(
    const Settings& settings,
    std::string_view in_response_to,
    std::string_view destination,
    std::int64_t now,
    bool success
)
{
    return R"(<samlp:LogoutResponse xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" )"
           R"(xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_)" +
           util::random_hex(16) + R"(" Version="2.0" IssueInstant=")" + time_stamp(now) +
           R"(" Destination=")" + util::xml_escape(destination) + R"(" InResponseTo=")" +
           util::xml_escape(in_response_to) + R"("><saml:Issuer>)" +
           util::xml_escape(settings.sp_entity_id) +
           R"(</saml:Issuer><samlp:Status><samlp:StatusCode Value=")" +
           (success ? "urn:oasis:names:tc:SAML:2.0:status:Success"
                    : "urn:oasis:names:tc:SAML:2.0:status:Responder") +
           R"("/></samlp:Status></samlp:LogoutResponse>)";
}

std::string build_authn_request(
    const Settings& settings,
    std::string_view request_id,
    std::string_view destination,
    std::int64_t now
)
{
    const std::string stamp = time_stamp(now);
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
    std::string_view relay_state,
    std::string_view parameter,
    std::string_view private_key_pem
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
        {std::string{parameter}, util::base64_encode(packed)}
    };
    if (!relay_state.empty()) {
        query.emplace_back("RelayState", std::string{relay_state});
    }
    if (!private_key_pem.empty()) {
        // The HTTP-Redirect binding signs the query as it is sent (without the signature itself).
        query.emplace_back("SigAlg", std::string{ALG_RSA_SHA256});
        const std::string signature = sign_rsa_sha256(private_key_pem, util::form_encode(query));
        if (signature.empty()) {
            return {};
        }
        query.emplace_back("Signature", signature);
    }
    return url + util::form_encode(query);
}

std::string metadata(const Settings& settings)
{
    return R"(<?xml version="1.0"?><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID=")" +
           util::xml_escape(settings.sp_entity_id) +
           R"("><md:SPSSODescriptor AuthnRequestsSigned=")" +
           (settings.sp_private_key_pem.empty() ? "false" : "true") +
           R"(" WantAssertionsSigned="true" )"
           R"(protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">)" +
           // The schema wants the key, then the logout endpoint, before the assertion consumer.
           (settings.sp_certificate_pem.empty()
                ? std::string{}
                : key_descriptor("signing", settings.sp_certificate_pem) +
                      (settings.sp_private_key_pem.empty()
                           ? std::string{}
                           : key_descriptor("encryption", settings.sp_certificate_pem))) +
           (settings.slo_url.empty()
                ? std::string{}
                : R"(<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location=")" +
                      util::xml_escape(settings.slo_url) + R"("/>)") +
           R"(<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location=")" +
           util::xml_escape(settings.acs_url) +
           R"(" index="0" isDefault="true"/></md:SPSSODescriptor></md:EntityDescriptor>)";
}

} // namespace nc::saml
