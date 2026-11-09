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
#include <sstream>

namespace {

namespace fs = std::filesystem;
using nc::http::Request;
using nc::http::Response;

const std::string SP = "https://cloud.example/saml/metadata";
const std::string ACS = "https://cloud.example/index.php/apps/user_saml/saml/acs";
const std::string IDP = "https://idp.example/metadata";

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

    explicit Idp(const std::string& name)
    {
        dir = (fs::temp_directory_path() / ("nc-saml-" + name + "-" + nc::util::random_hex(4)))
                  .string();
        fs::create_directories(dir);
        NC_CHECK_EQ(
            std::system(("openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=idp.example "
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
        const std::string ns = local_name == "Response" ? "urn:oasis:names:tc:SAML:2.0:protocol"
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
    std::string response = response_xml(o, assertion);
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
    settings.idp_entity_id = IDP;
    settings.idp_certificate_pem = idp.certificate;
    return settings;
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

void test_login_flow()
{
    const Idp idp{"flow"};
    const std::string dir =
        (fs::temp_directory_path() / ("nc-saml-flow-" + nc::util::random_hex(4))).string();
    fs::create_directories(dir);
    {
        std::ofstream{dir + "/idp.pem"} << idp.certificate;
    }
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\n[users]\npbkdf2_iterations = 3\n[saml]\nurl = "
                          "https://cloud.example\nsp_entity_id = " +
                          SP +
                          "\n"
                          "idp_entity_id = " +
                          IDP +
                          "\nidp_sso_url = https://idp.example/sso\nidp_certificate_file = " + dir +
                          "/idp.pem\nuid_attribute = \nemail_attribute = mail\n"
                          "displayname_attribute = cn\n"
    )
                          .value()};
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
    if (code != std::string::npos) {
        const std::string token = body.substr(code + 6, body.find("</code>") - code - 6);
        Request authed{"GET", "/ocs/v2.php/cloud/apppasswords"};
        authed.add_header("Authorization", "Basic " + nc::util::base64_encode("alice:" + token));
        NC_CHECK_EQ(kernel.handle(std::move(authed)).get_status(), 200);
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
    kernel.stop();
    fs::remove_all(dir);
}

} // namespace

int main()
{
    test_validation();
    test_login_flow();
    return NC_TEST_RESULT();
}
