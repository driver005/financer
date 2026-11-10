#include "saml.h"

#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <openssl/aead.h>
#include <sstream>
#include <zlib.h>

namespace {

namespace fs = std::filesystem;
using nc::http::Request;
using nc::http::Response;

const std::string SP = "https://cloud.example/saml/metadata";
const std::string ACS = "https://cloud.example/index.php/apps/user_saml/saml/acs";
const std::string IDP = "https://idp.example/metadata";
const std::string SLO = "https://cloud.example/index.php/apps/user_saml/saml/logout";

std::string stamp(std::int64_t seconds)
{
    std::tm moment{};
    const std::time_t value = static_cast<std::time_t>(seconds);
    gmtime_r(&value, &moment);
    char text[32];
    std::strftime(text, sizeof(text), "%Y-%m-%dT%H:%M:%SZ", &moment);
    return text;
}

std::int64_t now()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch()
    )
        .count();
}

std::string slurp(const fs::path& path)
{
    std::ifstream stream{path, std::ios::binary};
    std::ostringstream text;
    text << stream.rdbuf();
    return text.str();
}

/// An identity provider: a key and certificate, and a signer that is not this code (xmlsec1 is an
/// independent XML-DSig implementation).
struct Idp
{
    std::string dir{};
    std::string certificate{};

    /// `curve` (P-256, P-384, P-521) makes an elliptic curve key instead of an RSA one.
    explicit Idp(const std::string& name, const std::string& curve = {})
    {
        dir = (fs::temp_directory_path() / ("nc-saml-" + name + "-" + nc::util::random_hex(4)))
                  .string();
        fs::create_directories(dir);
        NC_CHECK_EQ(
            std::system(("openssl req -x509 -newkey " +
                         (curve.empty() ? std::string{"rsa:2048"}
                                        : "ec -pkeyopt ec_paramgen_curve:" + curve) +
                         " -nodes -days 1 -subj /CN=idp.example "
                         "-keyout " +
                         dir + "/key.pem -out " + dir + "/cert.pem >/dev/null 2>&1")
                            .c_str()),
            0
        );
        certificate = slurp(dir + "/cert.pem");
    }

    ~Idp()
    {
        fs::remove_all(dir);
    }

    /// Signs the element of `local_name` (Response or Assertion) that has this ID.
    std::string
    sign(const std::string& xml, const std::string& local_name, const std::string& key = {}) const
    {
        {
            std::ofstream{dir + "/in.xml", std::ios::binary} << xml;
        }
        const std::string ns = local_name == "Response" || local_name == "LogoutRequest"
                                   ? "urn:oasis:names:tc:SAML:2.0:protocol"
                                   : "urn:oasis:names:tc:SAML:2.0:assertion";
        // xmlsec1 1.3 does not fall back to the one loaded key for a template without a KeyInfo
        // unless asked to (--lax-key-search); 1.2 does not know that option and always falls back.
        const auto run = [&](const std::string& extra)
        {
            return std::system(("xmlsec1 --sign " + extra + "--privkey-pem " +
                                (key.empty() ? dir + "/key.pem" : key) + " --id-attr:ID " + ns +
                                ":" + local_name + " --output " + dir + "/out.xml " + dir +
                                "/in.xml >/dev/null 2>&1")
                                   .c_str());
        };
        int status = run("");
        if (status != 0) {
            status = run("--lax-key-search ");
        }
        if (status != 0) {
            // Show why (the attempts above are silent).
            std::system(("xmlsec1 --sign --lax-key-search --privkey-pem " +
                         (key.empty() ? dir + "/key.pem" : key) + " --id-attr:ID " + ns + ":" +
                         local_name + " --output " + dir + "/out.xml " + dir + "/in.xml >&2")
                            .c_str());
            std::fprintf(
                stderr,
                "xmlsec1 could not sign (exit %d); is the OpenSSL backend installed?\n",
                status
            );
        }
        NC_CHECK_EQ(status, 0);
        return status == 0 ? slurp(dir + "/out.xml") : std::string{};
    }
};

std::string signature_template(const std::string& id, const std::string& signature_method)
{
    return R"(<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo>)"
           R"(<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>)"
           R"(<ds:SignatureMethod Algorithm=")" +
           signature_method + R"("/><ds:Reference URI="#)" + id +
           R"("><ds:Transforms><ds:Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>)"
           R"(<ds:Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/></ds:Transforms>)"
           R"(<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue/>)"
           R"(</ds:Reference></ds:SignedInfo><ds:SignatureValue/></ds:Signature>)";
}

struct Options
{
    std::string request_id{"_req0123456789abcdef"};
    std::string name_id{"alice"};
    std::string audience{SP};
    std::string recipient{ACS};
    std::string destination{ACS};
    std::string issuer{IDP};
    std::string assertion_id{"_assertion1"};
    std::string status{"urn:oasis:names:tc:SAML:2.0:status:Success"};
    std::int64_t not_on_or_after{now() + 300};
    std::int64_t not_before{now() - 60};
    bool sign_assertion{true};
    bool sign_response{false};
    std::string signature_method{"http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"};
    // Certificate file of the service: the assertion is encrypted to it.
    std::string encrypt_cert{};
    // White space between the elements, there when the response is signed.
    bool pretty{false};
    // With openssl doing the key wrapping: {named digest, named MGF, wrapping digest, wrapping
    // MGF}.
    std::vector<std::string> openssl_oaep{};
    // Encrypt with xmlsec1 instead (what versions of it accept differs, so it is a cross-check).
    bool xmlsec{false};
    std::string encryption{"aes128-cbc"};
    std::string key_transport{
        R"(<xenc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p"/>)"
    };
};

std::string assertion_xml(const Options& o, bool with_signature_template)
{
    return R"(<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID=")" +
           o.assertion_id + R"(" Version="2.0" IssueInstant=")" + stamp(now()) +
           R"("><saml:Issuer>)" + o.issuer + "</saml:Issuer>" +
           (with_signature_template ? signature_template(o.assertion_id, o.signature_method) : "") +
           R"(<saml:Subject><saml:NameID>)" + o.name_id +
           R"(</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">)"
           R"(<saml:SubjectConfirmationData NotOnOrAfter=")" +
           stamp(o.not_on_or_after) + R"(" Recipient=")" + o.recipient + R"(" InResponseTo=")" +
           o.request_id +
           R"("/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore=")" +
           stamp(o.not_before) + R"(" NotOnOrAfter=")" + stamp(o.not_on_or_after) +
           R"("><saml:AudienceRestriction><saml:Audience>)" + o.audience +
           R"(</saml:Audience></saml:AudienceRestriction></saml:Conditions>)"
           R"(<saml:AttributeStatement><saml:Attribute Name="mail"><saml:AttributeValue>alice@example.org</saml:AttributeValue></saml:Attribute>)"
           R"(<saml:Attribute Name="cn"><saml:AttributeValue>Alice Example</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>)";
}

std::string response_xml(const Options& o, const std::string& assertion)
{
    return R"(<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp1" Version="2.0" IssueInstant=")" +
           stamp(now()) + R"(" Destination=")" + o.destination + R"(" InResponseTo=")" +
           o.request_id + R"("><saml:Issuer>)" + o.issuer + "</saml:Issuer>" +
           (o.sign_response ? signature_template("_resp1", o.signature_method) : "") +
           R"(<samlp:Status><samlp:StatusCode Value=")" + o.status + R"("/></samlp:Status>)" +
           assertion + "</samlp:Response>";
}

/// The text without its XML declaration.
std::string without_declaration(std::string xml)
{
    const std::size_t end = xml.find("?>");
    if (xml.rfind("<?xml", 0) == 0 && end != std::string::npos) {
        xml.erase(0, end + 2);
        while (!xml.empty() && (xml.front() == '\n' || xml.front() == ' ')) {
            xml.erase(0, 1);
        }
    }
    return xml;
}

/// The assertion encrypted to the certificate in `cert_file` by xmlsec1 (an independent
/// implementation), wrapped in an `EncryptedAssertion`; empty when xmlsec1 cannot do that (what it
/// says is passed on, once, because versions differ in what they accept).
std::string encrypt_assertion(
    const Idp& idp,
    const std::string& cert_file,
    const std::string& assertion,
    const std::string& algorithm,
    const std::string& key_transport
)
{
    const bool gcm = algorithm.find("gcm") != std::string::npos;
    const std::string uri =
        std::string{
            gcm ? "http://www.w3.org/2009/xmlenc11#" : "http://www.w3.org/2001/04/xmlenc#"
        } +
        algorithm;
    const std::string bits = algorithm.substr(3, 3); // "128" of "aes128-cbc"
    {
        std::ofstream{idp.dir + "/plain.xml", std::ios::binary} << assertion;
        std::ofstream{
            idp.dir + "/enc-template.xml",
            std::ios::binary
        } << R"(<xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" )"
             R"(xmlns:xenc11="http://www.w3.org/2009/xmlenc11#" Type="http://www.w3.org/2001/04/xmlenc#Element">)"
             R"(<xenc:EncryptionMethod Algorithm=")" +
                 uri +
                 R"("/><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><xenc:EncryptedKey>)" +
                 key_transport +
                 R"(<xenc:CipherData><xenc:CipherValue/></xenc:CipherData></xenc:EncryptedKey></ds:KeyInfo>)"
                 R"(<xenc:CipherData><xenc:CipherValue/></xenc:CipherData></xenc:EncryptedData>)";
    }
    fs::remove(idp.dir + "/encrypted.xml");
    const int status = std::system(("xmlsec1 --encrypt --pubkey-cert-pem " + cert_file +
                                    " --session-key aes-" + bits + " --xml-data " + idp.dir +
                                    "/plain.xml --output " + idp.dir + "/encrypted.xml " + idp.dir +
                                    "/enc-template.xml >" + idp.dir + "/xmlsec.out 2>&1")
                                       .c_str());
    if (status != 0 || !fs::exists(idp.dir + "/encrypted.xml")) {
        static bool said = false;
        if (!said) {
            said = true;
            std::fprintf(
                stderr,
                "xmlsec1 --encrypt failed:\n%s\n",
                slurp(idp.dir + "/xmlsec.out").c_str()
            );
        }
        return {};
    }
    return R"(<saml:EncryptedAssertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">)" +
           without_declaration(slurp(idp.dir + "/encrypted.xml")) + "</saml:EncryptedAssertion>";
}

/// The assertion encrypted to `cert_file` without xmlsec1, which differs between versions in what
/// it can do: `openssl` wraps the session key with RSA-OAEP (any digests) and does AES-CBC, and
/// BoringSSL's AEAD does AES-GCM. `wrap` is {digest the XML names, MGF the XML names, digest used,
/// MGF used}; an empty MGF name means the classic `rsa-oaep-mgf1p` (MGF1 with SHA-1). The two
/// pairs differ in the negative tests.
std::string encrypt_assertion_locally(
    const Idp& idp,
    const std::string& cert_file,
    const std::string& assertion,
    const std::string& cipher, // "aes128-cbc" ... "aes256-gcm"
    const std::vector<std::string>& wrap
)
{
    const auto digest_uri = [](const std::string& name) -> std::string
    {
        if (name == "sha1") {
            return "http://www.w3.org/2000/09/xmldsig#sha1";
        }
        if (name == "sha384") {
            return "http://www.w3.org/2001/04/xmldsig-more#sha384";
        }
        if (name == "sha256" || name == "sha512") {
            return "http://www.w3.org/2001/04/xmlenc#" + name;
        }
        return "urn:unknown:" + name;
    };
    const bool gcm = cipher.find("gcm") != std::string::npos;
    const std::size_t key_size = std::stoul(cipher.substr(3, 3)) / 8;
    const std::string session = nc::util::from_hex(nc::util::random_hex(key_size)).value();
    std::string body; // what the CipherValue holds
    if (gcm) {
        const std::string nonce = nc::util::from_hex(nc::util::random_hex(12)).value();
        EVP_AEAD_CTX context;
        EVP_AEAD_CTX_zero(&context);
        const EVP_AEAD* aead = key_size == 16 ? EVP_aead_aes_128_gcm() : EVP_aead_aes_256_gcm();
        NC_CHECK(
            EVP_AEAD_CTX_init(
                &context,
                aead,
                reinterpret_cast<const unsigned char*>(session.data()),
                session.size(),
                16,
                nullptr
            ) == 1
        );
        std::string sealed(assertion.size() + 16, '\0');
        std::size_t length = 0;
        NC_CHECK(
            EVP_AEAD_CTX_seal(
                &context,
                reinterpret_cast<unsigned char*>(sealed.data()),
                &length,
                sealed.size(),
                reinterpret_cast<const unsigned char*>(nonce.data()),
                nonce.size(),
                reinterpret_cast<const unsigned char*>(assertion.data()),
                assertion.size(),
                nullptr,
                0
            ) == 1
        );
        EVP_AEAD_CTX_cleanup(&context);
        sealed.resize(length);
        body = nonce + sealed;
    }
    const std::string iv = nc::util::from_hex(nc::util::random_hex(16)).value();
    // XML Encryption padding for CBC: any bytes, the last one counts them.
    std::string padded = assertion;
    const std::size_t pad = 16 - padded.size() % 16;
    padded.append(pad - 1, '\0');
    padded.push_back(static_cast<char>(pad));
    {
        std::ofstream{idp.dir + "/o-plain.bin", std::ios::binary} << padded;
        std::ofstream{idp.dir + "/o-key.bin", std::ios::binary} << session;
    }
    const bool pkcs1 = wrap[0] == "rsa-1_5"; // the transport that must be refused
    std::string commands =
        "openssl x509 -in " + cert_file + " -pubkey -noout > " + idp.dir +
        "/o-pub.pem 2>/dev/null && openssl pkeyutl -encrypt -pubin -inkey " + idp.dir +
        "/o-pub.pem " +
        (pkcs1 ? std::string{"-pkeyopt rsa_padding_mode:pkcs1"}
               : "-pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:" + wrap[2] +
                     " -pkeyopt rsa_mgf1_md:" + wrap[3]) +
        " -in " + idp.dir + "/o-key.bin -out " + idp.dir + "/o-wrapped.bin >/dev/null 2>&1";
    if (!gcm) {
        commands += " && openssl enc -aes-" + std::to_string(key_size * 8) + "-cbc -nopad -K " +
                    nc::util::to_hex(session) + " -iv " + nc::util::to_hex(iv) + " -in " + idp.dir +
                    "/o-plain.bin -out " + idp.dir + "/o-cipher.bin >/dev/null 2>&1";
    }
    if (std::system(commands.c_str()) != 0) {
        return {};
    }
    if (!gcm) {
        body = iv + slurp(idp.dir + "/o-cipher.bin");
    }
    const std::string transport =
        pkcs1 ? R"(<xenc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#rsa-1_5"/>)"
        : wrap[1].empty()
            ? R"(<xenc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p">)" +
                  (wrap[0] == "sha1"
                       ? std::string{}
                       : R"(<ds:DigestMethod Algorithm=")" + digest_uri(wrap[0]) + R"("/>)") +
                  "</xenc:EncryptionMethod>"
            : R"(<xenc:EncryptionMethod Algorithm="http://www.w3.org/2009/xmlenc11#rsa-oaep">)"
              R"(<ds:DigestMethod Algorithm=")" +
                  digest_uri(wrap[0]) +
                  R"("/><xenc11:MGF Algorithm="http://www.w3.org/2009/xmlenc11#mgf1)" + wrap[1] +
                  R"("/></xenc:EncryptionMethod>)";
    return R"(<saml:EncryptedAssertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">)"
           R"(<xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" )"
           R"(xmlns:xenc11="http://www.w3.org/2009/xmlenc11#" Type="http://www.w3.org/2001/04/xmlenc#Element">)"
           R"(<xenc:EncryptionMethod Algorithm=")" +
           std::string{
               gcm ? "http://www.w3.org/2009/xmlenc11#" : "http://www.w3.org/2001/04/xmlenc#"
           } +
           cipher +
           R"("/>)"
           R"(<ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><xenc:EncryptedKey>)" +
           transport + R"(<xenc:CipherData><xenc:CipherValue>)" +
           nc::util::base64_encode(slurp(idp.dir + "/o-wrapped.bin")) +
           R"(</xenc:CipherValue></xenc:CipherData></xenc:EncryptedKey></ds:KeyInfo>)"
           R"(<xenc:CipherData><xenc:CipherValue>)" +
           nc::util::base64_encode(body) +
           R"(</xenc:CipherValue></xenc:CipherData></xenc:EncryptedData></saml:EncryptedAssertion>)";
}

/// A response for these options, signed by the identity provider.
std::string make_response(const Idp& idp, const Options& o)
{
    std::string assertion = assertion_xml(o, o.sign_assertion);
    if (o.sign_assertion) {
        // Sign the assertion on its own, then put it into the response.
        assertion = idp.sign(assertion, "Assertion");
        const std::size_t declaration = assertion.find("?>");
        if (assertion.rfind("<?xml", 0) == 0 && declaration != std::string::npos) {
            assertion.erase(0, declaration + 2);
            while (!assertion.empty() && (assertion.front() == '\n' || assertion.front() == ' ')) {
                assertion.erase(0, 1);
            }
        }
    }
    if (!o.encrypt_cert.empty() && o.xmlsec) {
        assertion =
            encrypt_assertion(idp, o.encrypt_cert, assertion, o.encryption, o.key_transport);
    } else if (!o.encrypt_cert.empty()) {
        assertion = encrypt_assertion_locally(
            idp,
            o.encrypt_cert,
            assertion,
            o.encryption,
            o.openssl_oaep.size() == 4 ? o.openssl_oaep
                                       : std::vector<std::string>{"sha1", "", "sha1", "sha1"}
        );
    }
    std::string response = response_xml(o, assertion);
    if (o.pretty) {
        for (std::size_t at = 0; (at = response.find("><", at)) != std::string::npos; at += 4) {
            response.replace(at, 2, ">\n  <");
        }
    }
    if (o.sign_response) {
        response = idp.sign(response, "Response");
    }
    return response;
}

nc::saml::Settings settings_for(const Idp& idp)
{
    nc::saml::Settings settings;
    settings.sp_entity_id = SP;
    settings.acs_url = ACS;
    settings.slo_url = SLO;
    settings.idp_entity_id = IDP;
    settings.idp_certificate_pem = idp.certificate;
    return settings;
}

struct LogoutOptions
{
    std::string id{"_logout1"};
    std::string name_id{"alice"};
    std::string issuer{IDP};
    std::string destination{SLO};
    std::string not_on_or_after{};
    std::int64_t issued{now()};
    bool sign{true};
    int names{1};
};

/// A logout request of the identity provider, signed unless the options say otherwise.
std::string make_logout(const Idp& idp, const LogoutOptions& o)
{
    std::string xml =
        R"(<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID=")" +
        o.id + R"(" Version="2.0" IssueInstant=")" + stamp(o.issued) + R"(" Destination=")" +
        o.destination + "\"" +
        (o.not_on_or_after.empty() ? std::string{} : " NotOnOrAfter=\"" + o.not_on_or_after + "\""
        ) +
        "><saml:Issuer>" + o.issuer + "</saml:Issuer>" +
        (o.sign ? signature_template(o.id, "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256")
                : std::string{});
    for (int i = 0; i < o.names; ++i) {
        xml += "<saml:NameID>" + o.name_id + "</saml:NameID>";
    }
    xml += "</samlp:LogoutRequest>";
    return o.sign ? idp.sign(xml, "LogoutRequest") : xml;
}

void test_validation()
{
    const Idp idp{"idp"};
    const Idp other{"other"};
    const nc::saml::Settings settings = settings_for(idp);
    const Options plain;
    const auto check =
        [&](const std::string& xml, const std::string& request = "_req0123456789abcdef")
    {
        return nc::saml::validate_response(xml, settings, request, now());
    };

    // A good response, signed on the assertion: accepted, and the person's attributes come out.
    const std::string good = make_response(idp, plain);
    const auto accepted = check(good);
    NC_CHECK(accepted.has_value());
    if (accepted) {
        NC_CHECK_EQ(accepted->name_id, "alice");
        NC_CHECK_EQ(accepted->id, "_assertion1");
        NC_CHECK_EQ(accepted->attributes.at("mail").front(), "alice@example.org");
        NC_CHECK_EQ(accepted->attributes.at("cn").front(), "Alice Example");
    }
    // Signed on the response instead (the assertion inside is covered by it).
    Options on_response;
    on_response.sign_assertion = false;
    on_response.sign_response = true;
    NC_CHECK(check(make_response(idp, on_response)).has_value());
    // Both signed.
    Options both;
    both.sign_response = true;
    NC_CHECK(check(make_response(idp, both)).has_value());

    // Nobody signed it, someone else signed it, or it was changed after it was signed.
    Options unsigned_options;
    unsigned_options.sign_assertion = false;
    NC_CHECK(!check(make_response(idp, unsigned_options)).has_value());
    {
        const Idp attacker{"attacker"};
        // Signed with another key but presented as the identity provider's: wrong signature.
        NC_CHECK(!check(attacker.sign(assertion_xml(plain, true), "Assertion")).has_value());
        const std::string forged =
            response_xml(plain, attacker.sign(assertion_xml(plain, true), "Assertion"));
        NC_CHECK(!check(forged).has_value());
    }
    {
        std::string changed = good;
        const std::size_t at = changed.find(">alice<");
        NC_CHECK(at != std::string::npos);
        if (at != std::string::npos) {
            changed.replace(at, 7, ">admin<");
            NC_CHECK(!check(changed).has_value());
        }
    }

    // Signature wrapping: the signed assertion is kept as a decoy and the one that is read is not
    // signed. Every shape of it is refused.
    {
        const std::string signed_assertion = idp.sign(assertion_xml(plain, true), "Assertion");
        Options evil = plain;
        evil.name_id = "admin";
        evil.assertion_id = "_evil";
        const std::string evil_assertion = assertion_xml(evil, false);
        const std::size_t start = signed_assertion.find("<saml:Assertion");
        NC_CHECK(start != std::string::npos);
        std::string stripped =
            start == std::string::npos ? std::string{} : signed_assertion.substr(start);
        // 1. an unsigned assertion in front of the signed one
        NC_CHECK(!check(response_xml(plain, evil_assertion + stripped)).has_value());
        // 2. the signed one hidden in Extensions, the unsigned one where it is read
        NC_CHECK(
            !check(response_xml(
                       plain,
                       "<samlp:Extensions xmlns:samlp=\"urn:oasis:names:tc:SAML:2.0:protocol\">" +
                           stripped + "</samlp:Extensions>" + evil_assertion
                   ))
                 .has_value()
        );
        // 3. an unsigned assertion that borrows the signed one's ID
        evil.assertion_id = "_assertion1";
        NC_CHECK(!check(response_xml(plain, assertion_xml(evil, false) + stripped)).has_value());
        NC_CHECK(!check(response_xml(
                            plain,
                            "<saml:Advice xmlns:saml=\"urn:oasis:names:tc:SAML:2.0:assertion\">" +
                                stripped + "</saml:Advice>" + assertion_xml(evil, false)
                        ))
                      .has_value());
    }

    // The conditions.
    const auto refused = [&](Options options)
    {
        return !check(make_response(idp, options)).has_value();
    };
    {
        Options o;
        o.audience = "https://other.example/metadata";
        NC_CHECK(refused(o));
    }
    {
        Options o;
        o.recipient = "https://evil.example/acs";
        NC_CHECK(refused(o));
    }
    {
        Options o;
        o.destination = "https://evil.example/acs";
        NC_CHECK(refused(o));
    }
    {
        Options o;
        o.issuer = "https://evil.example/idp";
        NC_CHECK(refused(o));
    }
    {
        Options o;
        o.not_on_or_after = now() - 3'600;
        o.not_before = now() - 7'200;
        NC_CHECK(refused(o));
    }
    {
        Options o;
        o.not_before = now() + 3'600;
        NC_CHECK(refused(o));
    }
    {
        Options o;
        o.status = "urn:oasis:names:tc:SAML:2.0:status:Responder";
        NC_CHECK(refused(o));
    }
    // It answers another request than the one this server made.
    NC_CHECK(!check(good, "_req_someone_elses").has_value());
    // A weaker signature is not taken (the test has to make it with sha1).
    {
        Options o;
        o.signature_method = "http://www.w3.org/2000/09/xmldsig#rsa-sha1";
        NC_CHECK(refused(o));
    }

    // Hostile documents: a DTD (entity expansion, external files), garbage, nothing, too much.
    NC_CHECK(
        !check("<!DOCTYPE r [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><r>&x;</r>").has_value()
    );
    NC_CHECK(
        !check("<?xml version=\"1.0\"?><!DOCTYPE lolz [<!ENTITY a \"aaaa\">]>" + good).has_value()
    );
    NC_CHECK(!check("not xml at all").has_value());
    NC_CHECK(!check("").has_value());
    NC_CHECK(!check(std::string(2U * 1'024U * 1'024U, ' ') + good).has_value());
    NC_CHECK(!check("<a/>").has_value());

    // Request, metadata and time helpers.
    const std::string request =
        nc::saml::build_authn_request(settings, "_abc", "https://idp.example/sso", now());
    NC_CHECK(request.find("AssertionConsumerServiceURL=\"" + ACS + "\"") != std::string::npos);
    NC_CHECK(
        nc::saml::redirect_url("https://idp.example/sso", request, "x").find("SAMLRequest=") !=
        std::string::npos
    );
    NC_CHECK(
        nc::saml::metadata(settings).find("WantAssertionsSigned=\"true\"") != std::string::npos
    );
    NC_CHECK_EQ(nc::saml::parse_time("1970-01-02T00:00:00Z").value_or(0), std::int64_t{86'400});
    NC_CHECK_EQ(nc::saml::parse_time("1970-01-02T00:00:00.250Z").value_or(0), std::int64_t{86'400});
    NC_CHECK(!nc::saml::parse_time("1970-01-02 00:00:00").has_value());
    NC_CHECK(!nc::saml::parse_time("garbage").has_value());
}

void test_ecdsa_signatures()
{
    struct Curve
    {
        const char* name;
        const char* algorithm;
    };

    const Curve curves[] = {
        {"P-256", "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"},
        {"P-384", "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384"},
        {"P-521", "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512"},
    };
    for (const Curve& curve: curves) {
        const Idp idp{"ec", curve.name};
        const nc::saml::Settings settings = settings_for(idp);
        const auto check = [&](const std::string& xml)
        {
            return nc::saml::validate_response(xml, settings, "_req0123456789abcdef", now());
        };
        Options options;
        options.signature_method = curve.algorithm;
        const std::string good = make_response(idp, options);
        // xmlsec1 signed with ECDSA: the response is read, on the assertion and on the response.
        NC_CHECK(good.find("ecdsa-sha") != std::string::npos);
        NC_CHECK(check(good).has_value());
        Options on_response = options;
        on_response.sign_assertion = false;
        on_response.sign_response = true;
        NC_CHECK(check(make_response(idp, on_response)).has_value());
        // Changed after signing, or signed by another key of the same kind.
        std::string changed = good;
        const std::size_t at = changed.find(">alice<");
        NC_CHECK(at != std::string::npos);
        if (at != std::string::npos) {
            changed.replace(at, 7, ">admin<");
            NC_CHECK(!check(changed).has_value());
        }
        const Idp other{"ec-other", curve.name};
        NC_CHECK(!check(make_response(other, options)).has_value());
        // The algorithm in the message does not pick the key kind: an RSA algorithm with this
        // certificate is refused (the signature is rewritten to claim RSA).
        std::string claims_rsa = good;
        const std::size_t method = claims_rsa.find(curve.algorithm);
        NC_CHECK(method != std::string::npos);
        if (method != std::string::npos) {
            claims_rsa.replace(
                method,
                std::string_view{curve.algorithm}.size(),
                "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"
            );
            NC_CHECK(!check(claims_rsa).has_value());
        }
        // A truncated signature value (r and s must fill the curve's width) is refused.
        std::string cut = good;
        const std::size_t value = cut.find("<ds:SignatureValue>");
        NC_CHECK(value != std::string::npos);
        if (value != std::string::npos) {
            cut.insert(value + 19, "AAAA");
            NC_CHECK(!check(cut).has_value());
        }
    }
    // An RSA certificate with an ECDSA algorithm is refused as well.
    {
        const Idp rsa{"rsa-key"};
        const nc::saml::Settings settings = settings_for(rsa);
        const Idp ec{"ec-key", "P-256"};
        Options options;
        options.signature_method = curves[0].algorithm;
        NC_CHECK(!nc::saml::validate_response(
                      make_response(ec, options),
                      settings,
                      "_req0123456789abcdef",
                      now()
        )
                      .has_value());
    }
}

/// `text` with the first `from` replaced by `to` (the text itself when `from` is not there).
std::string replaced(std::string text, const std::string& from, const std::string& to)
{
    const std::size_t at = text.find(from);
    NC_CHECK(at != std::string::npos);
    if (at != std::string::npos) {
        text.replace(at, from.size(), to);
    }
    return text;
}

/// A logout request as the identity provider sends it by the HTTP-Redirect binding: the query
/// string, signed over `SAMLRequest[&RelayState]&SigAlg` by `openssl dgst` (not this code).
std::string signed_redirect_query(
    const Idp& idp,
    const std::string& xml,
    const std::string& relay = "back",
    const std::string& algorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    const std::string& digest = "sha256"
)
{
    const std::string url = nc::saml::redirect_url("https://sp.example/", xml, relay);
    std::string query = url.substr(url.find('?') + 1);
    query += "&" + nc::util::form_encode({{"SigAlg", algorithm}});
    {
        std::ofstream{idp.dir + "/q.txt", std::ios::binary} << query;
    }
    const int status = std::system(("openssl dgst -" + digest + " -sign " + idp.dir +
                                    "/key.pem -out " + idp.dir + "/q.sig " + idp.dir + "/q.txt")
                                       .c_str());
    NC_CHECK_EQ(status, 0);
    return query + "&" +
           nc::util::form_encode({{"Signature", nc::util::base64_encode(slurp(idp.dir + "/q.sig"))}}
           );
}

void test_redirect_logout()
{
    const Idp idp{"redirect"};
    const nc::saml::Settings settings = settings_for(idp);
    const std::int64_t at = now();
    const std::string xml = make_logout(idp, {.sign = false});
    const std::string good = signed_redirect_query(idp, xml);

    // The signed query opens, and the request inside is the identity provider's.
    const auto opened = nc::saml::open_redirect_message(good, "SAMLRequest", settings);
    NC_CHECK(opened.has_value());
    if (opened) {
        NC_CHECK_EQ(*opened, xml);
        const auto request = nc::saml::validate_logout_request(*opened, settings, at, true);
        NC_CHECK(request.has_value());
        if (request) {
            NC_CHECK_EQ(request->name_id, "alice");
        }
        // Without a signature around it, an unsigned request is not enough.
        NC_CHECK(!nc::saml::validate_logout_request(*opened, settings, at).has_value());
    }
    // Without the relay state, and with the stronger hashes.
    NC_CHECK(nc::saml::open_redirect_message(
                 signed_redirect_query(idp, xml, ""),
                 "SAMLRequest",
                 settings
    )
                 .has_value());
    NC_CHECK(nc::saml::open_redirect_message(
                 signed_redirect_query(
                     idp,
                     xml,
                     "back",
                     "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512",
                     "sha512"
                 ),
                 "SAMLRequest",
                 settings
    )
                 .has_value());

    // Anything changed, taken away or added after the signing is refused.
    const auto refused = [&](const std::string& query)
    {
        return !nc::saml::open_redirect_message(query, "SAMLRequest", settings).has_value();
    };
    {
        std::string changed = good;
        const std::size_t message = changed.find("SAMLRequest=") + 12;
        changed[message + 4] = changed[message + 4] == 'A' ? 'B' : 'A';
        NC_CHECK(refused(changed));
    }
    NC_CHECK(refused(replaced(good, "RelayState=back", "RelayState=other")));
    // SigAlg changed to another hash (the key is the same); not signed at all; signed by someone
    // else.
    NC_CHECK(refused(replaced(good, "rsa-sha256", "rsa-sha512")));
    NC_CHECK(refused(good.substr(0, good.find("&Signature="))));
    NC_CHECK(refused(signed_redirect_query(Idp{"redirect-stranger"}, xml)));
    // The signed text is built in the order the binding fixes (so the order of the parts as sent
    // does not matter); a part twice is refused.
    {
        const auto parts = nc::util::split(good, '&');
        NC_CHECK(refused(good + "&" + parts.at(1)));
        NC_CHECK(refused(good + "&" + parts.at(0)));
    }
    // An elliptic curve algorithm does not fit this RSA certificate.
    NC_CHECK(refused(replaced(good, "rsa-sha256", "ecdsa-sha256")));
    // A message that inflates to more than it may is refused although it is signed: 4 MiB of
    // zeros compress to a few kilobytes.
    {
        const std::string bomb =
            "<samlp:LogoutRequest xmlns:samlp=\"urn:oasis:names:tc:SAML:2.0:protocol\">" +
            std::string(4U * 1'024U * 1'024U, ' ') + "</samlp:LogoutRequest>";
        NC_CHECK(refused(signed_redirect_query(idp, bomb)));
    }
    // A request that is not a logout request: the message opens (it is signed) but is not valid.
    {
        const auto other = nc::saml::open_redirect_message(
            signed_redirect_query(idp, "<a/>"),
            "SAMLRequest",
            settings
        );
        NC_CHECK(other.has_value());
        if (other) {
            NC_CHECK(!nc::saml::validate_logout_request(*other, settings, at, true).has_value());
        }
    }
}

void test_logout_validation()
{
    const Idp idp{"logout"};
    const Idp other{"logout-other"};
    const nc::saml::Settings settings = settings_for(idp);
    const auto check = [&](const std::string& xml)
    {
        return nc::saml::validate_logout_request(xml, settings, now());
    };

    const auto good = check(make_logout(idp, {}));
    NC_CHECK(good.has_value());
    if (good) {
        NC_CHECK_EQ(good->name_id, std::string{"alice"});
        NC_CHECK_EQ(good->id, std::string{"_logout1"});
    }

    // Only the identity provider may end sessions.
    NC_CHECK(!check(make_logout(idp, {.sign = false})).has_value());
    NC_CHECK(!check(make_logout(other, {})).has_value());
    NC_CHECK(!check(make_logout(idp, {.issuer = "https://evil.example/metadata"})).has_value());
    // Not for this endpoint, not current, expired, or not naming exactly one person.
    NC_CHECK(!check(make_logout(idp, {.destination = "https://other.example/logout"})).has_value());
    NC_CHECK(!check(make_logout(idp, {.issued = now() - 3'600})).has_value());
    NC_CHECK(!check(make_logout(idp, {.issued = now() + 3'600})).has_value());
    NC_CHECK(!check(make_logout(idp, {.not_on_or_after = stamp(now() - 600)})).has_value());
    NC_CHECK(check(make_logout(idp, {.not_on_or_after = stamp(now() + 600)})).has_value());
    NC_CHECK(!check(make_logout(idp, {.names = 2})).has_value());
    NC_CHECK(!check(make_logout(idp, {.names = 0})).has_value());
    // A signature that does not cover what is being read: a changed name after signing.
    {
        std::string changed = make_logout(idp, {});
        const std::size_t at = changed.find(">alice<");
        NC_CHECK(at != std::string::npos);
        if (at != std::string::npos) {
            changed.replace(at, 7, ">admin<");
            NC_CHECK(!check(changed).has_value());
        }
    }
    // An assertion-style or response document is not a logout request; DTDs and garbage are
    // refused.
    NC_CHECK(!check("<a/>").has_value());
    NC_CHECK(!check("").has_value());
    NC_CHECK(
        !check("<!DOCTYPE r [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><r>&x;</r>").has_value()
    );

    // The answer names the request it answers, and the metadata offers the endpoint.
    const std::string answer = nc::saml::build_logout_response(
        settings,
        "_logout1",
        "https://idp.example/slo",
        now(),
        true
    );
    NC_CHECK(answer.find("InResponseTo=\"_logout1\"") != std::string::npos);
    NC_CHECK(answer.find("status:Success") != std::string::npos);
    NC_CHECK(
        nc::saml::build_logout_response(settings, "_x", "https://idp.example/slo", now(), false)
            .find("status:Responder") != std::string::npos
    );
    NC_CHECK(
        nc::saml::redirect_url("https://idp.example/slo", answer, "", "SAMLResponse")
            .find("?SAMLResponse=") != std::string::npos
    );
    NC_CHECK(nc::saml::metadata(settings).find("SingleLogoutService") != std::string::npos);
    nc::saml::Settings without = settings;
    without.slo_url.clear();
    NC_CHECK(nc::saml::metadata(without).find("SingleLogoutService") == std::string::npos);
}

/// Inflates what the HTTP-Redirect binding carries (raw DEFLATE, then base64).
std::string redirect_payload(const std::string& encoded)
{
    const auto packed = nc::util::base64_decode(encoded);
    if (!packed) {
        return {};
    }
    z_stream stream{};
    inflateInit2(&stream, -15);
    stream.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(packed->data()));
    stream.avail_in = static_cast<uInt>(packed->size());
    std::string out(64U * 1'024U, '\0');
    stream.next_out = reinterpret_cast<Bytef*>(out.data());
    stream.avail_out = static_cast<uInt>(out.size());
    inflate(&stream, Z_FINISH);
    out.resize(stream.total_out);
    inflateEnd(&stream);
    return out;
}

/// Whether `signature` (base64) is a valid RSA-SHA256 signature of `data` by the key of
/// `cert_file`, checked by `openssl`, which is not this code.
bool openssl_verifies(
    const std::string& dir,
    const std::string& cert_file,
    const std::string& data,
    const std::string& signature
)
{
    const auto raw = nc::util::base64_decode(signature);
    if (!raw) {
        return false;
    }
    {
        std::ofstream{dir + "/data.bin", std::ios::binary} << data;
        std::ofstream{dir + "/sig.bin", std::ios::binary} << *raw;
    }
    return std::system(("openssl x509 -in " + cert_file + " -pubkey -noout > " + dir +
                        "/pub.pem 2>/dev/null && openssl dgst -sha256 -verify " + dir +
                        "/pub.pem -signature " + dir + "/sig.bin " + dir +
                        "/data.bin >/dev/null 2>&1")
                           .c_str()) == 0;
}

void test_signed_requests()
{
    const Idp sp{"sp"};
    nc::saml::Settings settings = settings_for(sp);
    settings.sp_certificate_pem = sp.certificate;
    settings.sp_private_key_pem = slurp(sp.dir + "/key.pem");
    const std::string cert_file = sp.dir + "/cert.pem";

    const std::string xml =
        nc::saml::build_logout_request(settings, "_lo9", "https://idp.example/slo", "alice", now());
    NC_CHECK(xml.find("<saml:NameID>alice</saml:NameID>") != std::string::npos);
    NC_CHECK(xml.find("ID=\"_lo9\"") != std::string::npos);
    NC_CHECK(xml.find("Destination=\"https://idp.example/slo\"") != std::string::npos);
    NC_CHECK(xml.find("<saml:Issuer>" + SP + "</saml:Issuer>") != std::string::npos);

    // The binding signs the query as it is sent; openssl, an independent implementation, checks it.
    const std::string url = nc::saml::redirect_url(
        "https://idp.example/slo",
        xml,
        "back to /here?a=b&c",
        "SAMLRequest",
        settings.sp_private_key_pem
    );
    NC_CHECK(url.rfind("https://idp.example/slo?SAMLRequest=", 0) == 0);
    const std::size_t query_at = url.find('?') + 1;
    const std::string query = url.substr(query_at);
    const std::size_t signature_at = query.find("&Signature=");
    NC_CHECK(signature_at != std::string::npos);
    if (signature_at != std::string::npos) {
        const auto form = nc::util::parse_form(query);
        const std::string signed_part = query.substr(0, signature_at);
        NC_CHECK(
            signed_part.find(
                "&SigAlg=http%3A%2F%2Fwww.w3.org%2F2001%2F04%2Fxmldsig-more%23rsa-sha256"
            ) != std::string::npos
        );
        NC_CHECK_EQ(nc::util::form_value(form, "RelayState"), "back to /here?a=b&c");
        NC_CHECK_EQ(redirect_payload(nc::util::form_value(form, "SAMLRequest")), xml);
        const std::string signature = nc::util::form_value(form, "Signature");
        NC_CHECK(openssl_verifies(sp.dir, cert_file, signed_part, signature));
        // Any change to what was signed breaks it.
        std::string changed = signed_part;
        changed.replace(changed.find("back"), 4, "evil");
        NC_CHECK(!openssl_verifies(sp.dir, cert_file, changed, signature));
        // Another service's key does not verify it.
        const Idp other{"sp-other"};
        NC_CHECK(!openssl_verifies(sp.dir, other.dir + "/cert.pem", signed_part, signature));
    }
    // Without a key nothing is signed; with one that cannot sign, nothing is sent.
    NC_CHECK(
        nc::saml::redirect_url("https://idp.example/slo", xml, "").find("Signature=") ==
        std::string::npos
    );
    NC_CHECK(
        nc::saml::redirect_url("https://idp.example/slo", xml, "", "SAMLRequest", "garbage").empty()
    );

    // The metadata carries the certificate and says that requests are signed.
    const std::string document = nc::saml::metadata(settings);
    NC_CHECK(document.find("AuthnRequestsSigned=\"true\"") != std::string::npos);
    NC_CHECK(document.find("<md:KeyDescriptor use=\"signing\">") != std::string::npos);
    NC_CHECK(document.find("<ds:X509Certificate>MII") != std::string::npos);
    NC_CHECK(document.find("BEGIN CERTIFICATE") == std::string::npos);
    NC_CHECK(
        document.find("KeyDescriptor") < document.find("SingleLogoutService") ||
        document.find("SingleLogoutService") == std::string::npos
    );
    NC_CHECK(
        nc::saml::metadata(settings_for(sp)).find("AuthnRequestsSigned=\"false\"") !=
        std::string::npos
    );
    NC_CHECK(nc::saml::metadata(settings_for(sp)).find("KeyDescriptor") == std::string::npos);
}

void test_encrypted_assertions()
{
    const Idp idp{"enc-idp"};
    const Idp service{"enc-sp"};
    const Idp stranger{"enc-other"};
    nc::saml::Settings settings = settings_for(idp);
    settings.sp_private_key_pem = slurp(service.dir + "/key.pem");
    settings.sp_certificate_pem = service.certificate;
    const std::string cert = service.dir + "/cert.pem";
    const auto check = [&](const std::string& xml, const nc::saml::Settings& use = {})
    {
        return nc::saml::validate_response(
            xml,
            use.idp_entity_id.empty() ? settings : use,
            "_req0123456789abcdef",
            now()
        );
    };
    const auto encrypted = [&](Options o)
    {
        o.encrypt_cert = cert;
        return o;
    };

    // White space between the elements is part of what a signer digests (regression: it used to be
    // dropped on reading, which broke every response that was printed with indentation).
    {
        Options o;
        o.sign_assertion = false;
        o.sign_response = true;
        o.pretty = true;
        const std::string response = make_response(idp, o);
        NC_CHECK(response.find(">\n  <saml:Issuer>") != std::string::npos);
        const auto accepted = check(response);
        NC_CHECK(accepted.has_value());
        if (!accepted) {
            std::fprintf(stderr, "pretty printed: %s\n", accepted.error().c_str());
        }
        Options both = encrypted({});
        both.sign_assertion = false;
        both.sign_response = true;
        both.pretty = true;
        NC_CHECK(check(make_response(idp, both)).has_value());
    }

    // Every cipher an identity provider is likely to use, the assertion signed inside. The local
    // encryptor is the baseline; xmlsec1 (an independent implementation, whose versions differ in
    // what they accept) is asked as well and counts when it can make the same.
    for (const char* cipher:
         {"aes128-cbc", "aes192-cbc", "aes256-cbc", "aes128-gcm", "aes256-gcm"}) {
        for (const bool with_xmlsec: {false, true}) {
            Options o = encrypted({});
            o.encryption = cipher;
            o.xmlsec = with_xmlsec;
            const std::string response = make_response(idp, o);
            if (response.find("EncryptedAssertion") == std::string::npos) {
                NC_CHECK(with_xmlsec); // the local encryptor must always work
                std::fprintf(stderr, "xmlsec1 cannot make %s here; skipped\n", cipher);
                continue;
            }
            const auto accepted = check(response);
            NC_CHECK(accepted.has_value());
            if (accepted) {
                NC_CHECK_EQ(accepted->name_id, "alice");
                NC_CHECK_EQ(accepted->attributes.at("mail").front(), "alice@example.org");
            } else {
                std::fprintf(
                    stderr,
                    "%s (%s): %s\n",
                    cipher,
                    with_xmlsec ? "xmlsec1" : "local",
                    accepted.error().c_str()
                );
            }
        }
    }
    // The signature on the response covers the cipher text: an unsigned assertion inside is fine.
    {
        Options o = encrypted({});
        o.sign_assertion = false;
        o.sign_response = true;
        const std::string response = make_response(idp, o);
        NC_CHECK(response.find("EncryptedAssertion") != std::string::npos);
        const auto accepted = check(response);
        NC_CHECK(accepted.has_value());
        if (!accepted) {
            std::fprintf(stderr, "signed response: %s\n", accepted.error().c_str());
        }
    }
    // ... and nothing signed anywhere is not.
    {
        Options o = encrypted({});
        o.sign_assertion = false;
        NC_CHECK(!check(make_response(idp, o)).has_value());
    }
    // Encrypted to somebody else, or signed by somebody else, or this service has no key.
    {
        Options o;
        o.encrypt_cert = stranger.dir + "/cert.pem";
        NC_CHECK(!check(make_response(idp, o)).has_value());
        NC_CHECK(!check(make_response(stranger, encrypted({}))).has_value());
        NC_CHECK(!check(make_response(idp, encrypted({})), settings_for(idp)).has_value());
    }
    // Damage to the cipher text, to the wrapped key, or to the structure.
    {
        const std::string good = make_response(idp, encrypted({}));
        const std::size_t values = good.find("<xenc:CipherValue>");
        NC_CHECK(values != std::string::npos);
        if (values != std::string::npos) {
            for (std::size_t from: {std::size_t{0}, values + 20}) {
                std::string broken = good;
                const std::size_t at = good.find("<xenc:CipherValue>", from) + 30;
                broken[at] = broken[at] == 'A' ? 'B' : 'A';
                NC_CHECK(!check(broken).has_value());
            }
            // The cipher text cut short, an unknown cipher, no key at all.
            std::string cut = good;
            const std::size_t last = cut.rfind("</xenc:CipherValue>");
            cut.erase(last - 40, 36);
            NC_CHECK(!check(cut).has_value());
        }
        std::string odd = good;
        const std::size_t cipher_at = odd.find("aes128-cbc");
        NC_CHECK(cipher_at != std::string::npos);
        if (cipher_at != std::string::npos) {
            odd.replace(cipher_at, 10, "des3-cbc00");
            NC_CHECK(!check(odd).has_value());
        }
        std::string keyless = good;
        const std::size_t key_at = keyless.find("<xenc:EncryptedKey>");
        NC_CHECK(key_at != std::string::npos);
        keyless.erase(key_at, keyless.find("</xenc:EncryptedKey>") + 20 - key_at);
        NC_CHECK(!check(keyless).has_value());
    }
    // One assertion only: a clear one next to the encrypted one is refused, so is an empty
    // response.
    {
        Options o = encrypted({});
        std::string two = make_response(idp, o);
        Options extra;
        extra.assertion_id = "_extra";
        two.insert(two.rfind("</samlp:Response>"), assertion_xml(extra, false));
        NC_CHECK(!check(two).has_value());
    }
    // PKCS#1 v1.5 key transport is not accepted, however well the rest is made.
    {
        Options o = encrypted({});
        o.openssl_oaep = {"rsa-1_5", "", "", ""};
        const std::string response = make_response(idp, o);
        NC_CHECK(response.find("rsa-1_5") != std::string::npos);
        NC_CHECK(!check(response).has_value());
    }
    // The same OAEP/SHA-256 with xmlsec1 doing the wrapping, when this version of it can.
    {
        Options o = encrypted({});
        o.xmlsec = true;
        o.key_transport =
            R"(<xenc:EncryptionMethod Algorithm="http://www.w3.org/2009/xmlenc11#rsa-oaep">)"
            R"(<ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>)"
            R"(<xenc11:MGF Algorithm="http://www.w3.org/2009/xmlenc11#mgf1sha256"/></xenc:EncryptionMethod>)";
        const std::string response = make_response(idp, o);
        if (response.find("EncryptedAssertion") != std::string::npos) {
            NC_CHECK(check(response).has_value());
        } else {
            std::fprintf(stderr, "xmlsec1 cannot make OAEP-SHA256 here; that case is skipped\n");
        }
    }
    // OAEP with other digests, wrapped by openssl: what the XML names is what has to be used.
    for (const std::vector<std::string>& digests: std::vector<std::vector<std::string>>{
             {"sha1", "sha1", "sha1", "sha1"},
             {"sha256", "sha256", "sha256", "sha256"},
             {"sha1", "sha256", "sha1", "sha256"},
             {"sha384", "sha384", "sha384", "sha384"},
             {"sha512", "sha1", "sha512", "sha1"}
         }) {
        Options o = encrypted({});
        o.openssl_oaep = digests;
        const std::string response = make_response(idp, o);
        NC_CHECK(response.find("EncryptedAssertion") != std::string::npos);
        const auto accepted = check(response);
        NC_CHECK(accepted.has_value());
        if (!accepted) {
            std::fprintf(
                stderr,
                "OAEP %s/%s: %s\n",
                digests[0].c_str(),
                digests[1].c_str(),
                accepted.error().c_str()
            );
        }
    }
    {
        // The XML says SHA-256 but the key was wrapped with SHA-1 (or the other way round):
        // refused.
        Options wrong = encrypted({});
        wrong.openssl_oaep = {"sha256", "sha256", "sha1", "sha1"};
        NC_CHECK(!check(make_response(idp, wrong)).has_value());
        Options mismatch = encrypted({});
        mismatch.openssl_oaep = {"sha1", "sha256", "sha1", "sha1"};
        NC_CHECK(!check(make_response(idp, mismatch)).has_value());
        // A digest nobody has heard of.
        Options unknown = encrypted({});
        unknown.openssl_oaep = {"md5", "sha1", "sha1", "sha1"};
        NC_CHECK(!check(make_response(idp, unknown)).has_value());
    }
    // The metadata offers the key for encryption, but only when this service can decrypt.
    NC_CHECK(
        nc::saml::metadata(settings).find("<md:KeyDescriptor use=\"encryption\">") !=
        std::string::npos
    );
    nc::saml::Settings signing_only = settings;
    signing_only.sp_private_key_pem.clear();
    NC_CHECK(nc::saml::metadata(signing_only).find("use=\"encryption\"") == std::string::npos);
}

void test_login_flow()
{
    const Idp idp{"flow"};
    const Idp service{"flow-sp"};
    const std::string dir =
        (fs::temp_directory_path() / ("nc-saml-flow-" + nc::util::random_hex(4))).string();
    fs::create_directories(dir);
    {
        std::ofstream{dir + "/idp.pem"} << idp.certificate;
        std::ofstream{dir + "/sp-cert.pem"} << service.certificate;
        std::ofstream{dir + "/sp-key.pem"} << slurp(service.dir + "/key.pem");
    }
    nc::Kernel kernel{
        nc::Config::parse(
            "data_dir = " + dir +
            "\n[users]\npbkdf2_iterations = 3\n[saml]\nurl = "
            "https://cloud.example\nsp_entity_id = " +
            SP +
            "\n"
            "idp_entity_id = " +
            IDP + "\nidp_sso_url = https://idp.example/sso\nidp_certificate_file = " + dir +
            "/idp.pem\nidp_slo_url = https://idp.example/slo\nsp_certificate_file = " + dir +
            "/sp-cert.pem\nsp_private_key_file = " + dir +
            "/sp-key.pem\n"
            "uid_attribute = \nemail_attribute = mail\n"
            "displayname_attribute = cn\n"
        )
            .value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"saml", "tokens", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    const auto call =
        [&](const std::string& method, const std::string& path, const std::string& body = {})
    {
        Request request{std::string{method}, std::string{path}};
        request.set_body(std::string{body});
        return kernel.handle(std::move(request));
    };
    const std::string base = "/index.php/apps/user_saml/saml";

    const Response metadata = call("GET", base + "/metadata");
    NC_CHECK_EQ(metadata.get_status(), 200);
    NC_CHECK(
        metadata.get_body().find("entityID=\"" + SP + "\"") != std::string::npos ||
        metadata.get_body().find(
            "entityID=\"https://cloud.example/index.php/apps/user_saml/saml/metadata\""
        ) != std::string::npos
    );

    // The login sends the browser to the identity provider, and remembers the request.
    const Response login = call("GET", base + "/login");
    NC_CHECK_EQ(login.get_status(), 302);
    NC_CHECK(
        std::string(login.header("Location")).rfind("https://idp.example/sso?SAMLRequest=", 0) == 0
    );
    const auto pending = [&]
    {
        const Response rows =
            kernel.get_services().call("db.query", "sql=SELECT+id+FROM+nc_saml_requests");
        return std::string{
            nc::util::trim(nc::util::form_value(nc::util::parse_form(rows.get_body()), "id"))
        };
    };
    const std::string request_id = pending();
    NC_CHECK(request_id.rfind("_", 0) == 0);

    // The identity provider answers: the person is created and gets an app password that works.
    Options options;
    options.request_id = request_id;
    options.assertion_id = "_assertion_" + nc::util::random_hex(6);
    options.not_on_or_after = now() + 300;
    const std::string answer = make_response(idp, options);
    const std::string form =
        nc::util::form_encode({{"SAMLResponse", nc::util::base64_encode(answer)}});
    const Response signed_in = call("POST", base + "/acs", form);
    NC_CHECK_EQ(signed_in.get_status(), 200);
    const std::string body = signed_in.get_body();
    const std::size_t code = body.find("<code>");
    NC_CHECK(code != std::string::npos);
    std::string token;
    const auto token_status = [&]
    {
        Request authed{"GET", "/ocs/v2.php/cloud/apppasswords"};
        authed.add_header("Authorization", "Basic " + nc::util::base64_encode("alice:" + token));
        return kernel.handle(std::move(authed)).get_status();
    };
    if (code != std::string::npos) {
        token = body.substr(code + 6, body.find("</code>") - code - 6);
        NC_CHECK_EQ(token_status(), 200);
    }
    // The same answer again is a replay; an answer to a request nobody made is refused.
    NC_CHECK_EQ(call("POST", base + "/acs", form).get_status(), 400);
    Options unsolicited = options;
    unsolicited.request_id = "_req" + nc::util::random_hex(12);
    NC_CHECK_EQ(
        call(
            "POST",
            base + "/acs",
            nc::util::form_encode(
                {{"SAMLResponse", nc::util::base64_encode(make_response(idp, unsolicited))}}
            )
        ).get_status(),
        400
    );
    // A request is used once, even when the answer to it is bad.
    (void)call("GET", base + "/login");
    Options broken;
    broken.request_id = pending();
    broken.audience = "https://other.example/metadata";
    NC_CHECK_EQ(
        call(
            "POST",
            base + "/acs",
            nc::util::form_encode(
                {{"SAMLResponse", nc::util::base64_encode(make_response(idp, broken))}}
            )
        ).get_status(),
        403
    );
    NC_CHECK_EQ(call("POST", base + "/acs", "SAMLResponse=%21%21%21").get_status(), 400);

    // Single logout. The metadata offers the endpoint.
    NC_CHECK(
        call("GET", base + "/metadata").get_body().find("SingleLogoutService") != std::string::npos
    );
    const auto logout_form = [&](const LogoutOptions& options, const Idp& signer)
    {
        return nc::util::form_encode(
            {{"SAMLRequest", nc::util::base64_encode(make_logout(signer, options))},
             {"RelayState", "back"}}
        );
    };
    // Unsigned, signed by someone else, or naming the wrong place: refused, the password stays.
    const Idp stranger{"flow-stranger"};
    NC_CHECK_EQ(
        call("POST", base + "/logout", logout_form({.sign = false}, idp)).get_status(),
        403
    );
    NC_CHECK_EQ(call("POST", base + "/logout", logout_form({}, stranger)).get_status(), 403);
    NC_CHECK_EQ(
        call("POST", base + "/logout", logout_form({.destination = "https://x.example/"}, idp))
            .get_status(),
        403
    );
    NC_CHECK_EQ(call("POST", base + "/logout", "SAMLRequest=%21%21%21").get_status(), 400);
    NC_CHECK_EQ(token_status(), 200);
    // The identity provider's request ends the session: the answer goes back to it, and the app
    // password the sign-in made no longer works.
    const Response ended = call("POST", base + "/logout", logout_form({.id = "_lo_a1b2c3"}, idp));
    NC_CHECK_EQ(ended.get_status(), 302);
    const std::string where{ended.header("Location")};
    NC_CHECK(where.rfind("https://idp.example/slo?SAMLResponse=", 0) == 0);
    NC_CHECK(where.find("RelayState=back") != std::string::npos);
    NC_CHECK_EQ(token_status(), 401);
    // The same request again is a replay.
    NC_CHECK_EQ(
        call("POST", base + "/logout", logout_form({.id = "_lo_a1b2c3"}, idp)).get_status(),
        403
    );
    // A person nobody here knows has nothing to end, which is still an answer of success.
    NC_CHECK_EQ(
        call("POST", base + "/logout", logout_form({.id = "_lo_other", .name_id = "nobody"}, idp))
            .get_status(),
        302
    );

    // Logout started from this side: sign in again, then ask to end the session. The app password
    // goes, and the browser is sent to the identity provider with a signed logout request.
    (void)call("GET", base + "/login");
    Options again;
    again.request_id = pending();
    again.assertion_id = "_assertion_" + nc::util::random_hex(6);
    again.not_on_or_after = now() + 300;
    const Response second = call(
        "POST",
        base + "/acs",
        nc::util::form_encode({{"SAMLResponse", nc::util::base64_encode(make_response(idp, again))}}
        )
    );
    NC_CHECK_EQ(second.get_status(), 200);
    {
        const std::string again_body = second.get_body();
        const std::size_t start = again_body.find("<code>");
        NC_CHECK(start != std::string::npos);
        if (start != std::string::npos) {
            token = again_body.substr(start + 6, again_body.find("</code>") - start - 6);
        }
    }
    NC_CHECK_EQ(token_status(), 200);
    // Not without being signed in.
    NC_CHECK_EQ(call("GET", base + "/sp-logout").get_status(), 401);
    NC_CHECK_EQ(token_status(), 200);
    Request leaving{"GET", base + "/sp-logout"};
    leaving.get_query() = "RelayState=done";
    leaving.add_header("Authorization", "Basic " + nc::util::base64_encode("alice:" + token));
    const Response left = kernel.handle(std::move(leaving));
    NC_CHECK_EQ(left.get_status(), 302);
    const std::string away{left.header("Location")};
    NC_CHECK(away.rfind("https://idp.example/slo?SAMLRequest=", 0) == 0);
    NC_CHECK(away.find("&SigAlg=") != std::string::npos);
    {
        const std::string query = away.substr(away.find('?') + 1);
        const auto sent = nc::util::parse_form(query);
        const std::string request_xml = redirect_payload(nc::util::form_value(sent, "SAMLRequest"));
        NC_CHECK(request_xml.find("<saml:NameID>alice</saml:NameID>") != std::string::npos);
        NC_CHECK(request_xml.find("Destination=\"https://idp.example/slo\"") != std::string::npos);
        NC_CHECK_EQ(nc::util::form_value(sent, "RelayState"), "done");
        const std::size_t signature_at = query.find("&Signature=");
        NC_CHECK(signature_at != std::string::npos);
        NC_CHECK(openssl_verifies(
            service.dir,
            service.dir + "/cert.pem",
            query.substr(0, signature_at),
            nc::util::form_value(sent, "Signature")
        ));
    }
    NC_CHECK_EQ(token_status(), 401);
    // The identity provider ends a session by redirect: the query is signed (not the XML), the
    // person's app password stops working, and the answer is a signed redirect back.
    {
        (void)call("GET", base + "/login");
        Options third;
        third.request_id = pending();
        third.assertion_id = "_assertion_" + nc::util::random_hex(6);
        third.not_on_or_after = now() + 300;
        const Response third_answer = call(
            "POST",
            base + "/acs",
            nc::util::form_encode(
                {{"SAMLResponse", nc::util::base64_encode(make_response(idp, third))}}
            )
        );
        NC_CHECK_EQ(third_answer.get_status(), 200);
        const std::string page_body = third_answer.get_body();
        const std::size_t code_at = page_body.find("<code>");
        NC_CHECK(code_at != std::string::npos);
        if (code_at != std::string::npos) {
            token = page_body.substr(code_at + 6, page_body.find("</code>") - code_at - 6);
        }
        NC_CHECK_EQ(token_status(), 200);
        const auto by_redirect = [&](const std::string& query)
        {
            Request request{"GET", base + "/logout"};
            request.get_query() = query;
            return kernel.handle(std::move(request));
        };
        LogoutOptions unsigned_xml;
        unsigned_xml.id = "_lo_redirect";
        unsigned_xml.sign = false;
        const std::string xml = make_logout(idp, unsigned_xml);
        // Signed by someone else, or not signed: nothing happens.
        NC_CHECK_EQ(
            by_redirect(signed_redirect_query(Idp{"flow-stranger2"}, xml)).get_status(),
            403
        );
        NC_CHECK_EQ(
            by_redirect(signed_redirect_query(idp, xml)
                            .substr(0, signed_redirect_query(idp, xml).find("&Signature=")))
                .get_status(),
            403
        );
        NC_CHECK_EQ(token_status(), 200);
        const Response ended_by_redirect = by_redirect(signed_redirect_query(idp, xml));
        NC_CHECK_EQ(ended_by_redirect.get_status(), 302);
        NC_CHECK(
            std::string{ended_by_redirect.header("Location")}
                .rfind("https://idp.example/slo?SAMLResponse=", 0) == 0
        );
        NC_CHECK_EQ(token_status(), 401);
        // Used once.
        NC_CHECK_EQ(by_redirect(signed_redirect_query(idp, xml)).get_status(), 403);
    }
    // The metadata offers the key; the identity provider's answer is a page, a request by redirect
    // is not accepted.
    NC_CHECK(call("GET", base + "/metadata").get_body().find("KeyDescriptor") != std::string::npos);
    const auto logout_query = [&](const std::string& query)
    {
        Request request{"GET", base + "/logout"};
        request.get_query() = query;
        return kernel.handle(std::move(request)).get_status();
    };
    NC_CHECK_EQ(logout_query("SAMLResponse=abc"), 200);
    NC_CHECK_EQ(logout_query("SAMLRequest=abc"), 403); // not signed
    kernel.stop();
    fs::remove_all(dir);
}

} // namespace

int main()
{
    test_validation();
    test_ecdsa_signatures();
    test_redirect_logout();
    test_logout_validation();
    test_signed_requests();
    test_encrypted_assertions();
    test_login_flow();
    return NC_TEST_RESULT();
}
