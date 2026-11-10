#include "webauthn.h"

#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/json.h"
#include "nextcloud/util/text.h"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>

namespace {

namespace fs = std::filesystem;
namespace wa = nc::webauthn;
using nc::http::Request;
using nc::http::Response;

const std::string RP = "cloud.example";
const std::string ORIGIN = "https://cloud.example";

/// The authenticator is a Python script (cryptography and cbor2, checked against Yubico's fido2
/// server code by its own `selfcheck`): it is not the code under test.
std::string python()
{
    const char* chosen = std::getenv("NC_TEST_PYTHON");
    return chosen != nullptr ? chosen : "python3";
}

std::string run(const std::string& arguments)
{
    std::string text;
    const std::string command =
        python() + " -I plugins/webauthn/tests/authenticator.py " + arguments + " 2>&1";
    if (FILE* pipe = popen(command.c_str(), "r")) {
        char buffer[4'096];
        while (fgets(buffer, sizeof(buffer), pipe) != nullptr) {
            text += buffer;
        }
        pclose(pipe);
    }
    return text;
}

bool have_python()
{
    const std::string command = python() + " -c 'import cbor2, cryptography' >/dev/null 2>&1";
    return std::system(command.c_str()) == 0;
}

std::string temp_dir(const std::string& name)
{
    const std::string dir =
        (fs::temp_directory_path() / ("nc-webauthn-" + name + "-" + nc::util::random_hex(4)))
            .string();
    fs::create_directories(dir);
    return dir;
}

std::string random_challenge()
{
    return *nc::util::from_hex(nc::util::random_hex(32));
}

wa::RelyingParty party()
{
    return {RP, {ORIGIN}};
}

/// A device in a state file: what it signs with, and what is stored of it after a registration.
struct Device
{
    std::string state;
    wa::Credential stored{};

    Device(const std::string& dir, const std::string& name, const std::string& algorithm) :
        state{dir + "/" + name + ".json"}
    {
        (void)run(state + " new " + algorithm);
    }

    std::string make(
        const char* command,
        const std::string& challenge,
        const std::string& flags = {},
        const std::string& origin = ORIGIN
    ) const
    {
        return run(
            state + " " + command + " " + RP + " " + origin + " " +
            wa::base64url_encode(challenge) + " " + flags
        );
    }
};

wa::Result<wa::ClientResponse> response_of(const std::string& json, bool registration)
{
    return wa::parse_client_response(json, registration);
}

void test_algorithm(const std::string& algorithm, std::int32_t cose)
{
    const std::string dir = temp_dir(algorithm);
    Device device{dir, "device", algorithm};
    const wa::RelyingParty rp = party();

    // A registration: the key, the id, the algorithm and the flags come out.
    const std::string challenge = random_challenge();
    const auto response = response_of(device.make("register", challenge), true);
    NC_CHECK(response.has_value());
    if (!response) {
        fs::remove_all(dir);
        return;
    }
    const auto registered = wa::verify_registration(rp, challenge, *response, true);
    NC_CHECK(registered.has_value());
    if (!registered) {
        std::fprintf(stderr, "%s: %s\n", algorithm.c_str(), registered.error().c_str());
        fs::remove_all(dir);
        return;
    }
    device.stored = *registered;
    NC_CHECK_EQ(registered->algorithm, cose);
    NC_CHECK_EQ(registered->id, response->credential_id);
    NC_CHECK_EQ(registered->counter, 0U);
    NC_CHECK(registered->user_verified);
    NC_CHECK(!registered->public_key.empty());

    // The same answer against another challenge, origin, relying party or id is refused.
    NC_CHECK(!wa::verify_registration(rp, random_challenge(), *response, false).has_value());
    NC_CHECK(!wa::verify_registration({RP, {"https://evil.example"}}, challenge, *response, false)
                  .has_value());
    NC_CHECK(!wa::verify_registration({"other.example", {ORIGIN}}, challenge, *response, false)
                  .has_value());
    const auto refused_registration = [&](const std::string& flags)
    {
        const std::string fresh = random_challenge();
        const auto bad = response_of(device.make("register", fresh, flags), true);
        return !bad || !wa::verify_registration(rp, fresh, *bad, false).has_value();
    };
    NC_CHECK(refused_registration("--origin https://evil.example"));
    NC_CHECK(refused_registration("--rp other.example"));
    NC_CHECK(refused_registration("--type webauthn.get"));
    NC_CHECK(refused_registration("--no-up"));
    NC_CHECK(refused_registration("--fmt packed")); // only attestation "none"
    NC_CHECK(refused_registration("--extensions"));
    NC_CHECK(refused_registration("--cross-origin"));
    NC_CHECK(refused_registration("--other-id")); // the id in the data is not the one sent
    {
        // A person who was not verified is refused when verification is required.
        const std::string fresh = random_challenge();
        const auto weak = response_of(device.make("register", fresh, "--no-uv"), true);
        NC_CHECK(weak.has_value());
        if (weak) {
            NC_CHECK(wa::verify_registration(rp, fresh, *weak, false).has_value());
            NC_CHECK(!wa::verify_registration(rp, fresh, *weak, true).has_value());
        }
    }
    // Cut, damaged and deeply nested attestation objects.
    {
        wa::ClientResponse cut = *response;
        cut.attestation_object.resize(cut.attestation_object.size() / 2);
        NC_CHECK(!wa::verify_registration(rp, challenge, cut, false).has_value());
        wa::ClientResponse junk = *response;
        junk.attestation_object = std::string(40, '\x81'); // array of array of array ...
        NC_CHECK(!wa::verify_registration(rp, challenge, junk, false).has_value());
        wa::ClientResponse trailing = *response;
        trailing.attestation_object.push_back(0);
        NC_CHECK(!wa::verify_registration(rp, challenge, trailing, false).has_value());
    }

    // Signing in: the counter grows with every answer.
    for (std::uint32_t expected = 1; expected <= 2; ++expected) {
        const std::string next = random_challenge();
        const auto answer = response_of(device.make("get", next), false);
        NC_CHECK(answer.has_value());
        if (!answer) {
            continue;
        }
        const auto assertion = wa::verify_assertion(rp, device.stored, next, *answer, true);
        NC_CHECK(assertion.has_value());
        if (assertion) {
            NC_CHECK_EQ(assertion->counter, expected);
            NC_CHECK(assertion->user_verified);
            device.stored.counter = assertion->counter;
        }
        // The same answer is not accepted a second time: the counter did not grow.
        if (assertion) {
            NC_CHECK(!wa::verify_assertion(rp, device.stored, next, *answer, true).has_value());
        }
    }
    const auto refused_assertion = [&](const std::string& flags, const std::string& origin = ORIGIN)
    {
        const std::string next = random_challenge();
        const auto bad = response_of(device.make("get", next, flags, origin), false);
        if (!bad) {
            return true;
        }
        // The state file has moved on; the stored counter has to move with it.
        wa::Credential current = device.stored;
        return !wa::verify_assertion(rp, current, next, *bad, false).has_value();
    };
    NC_CHECK(refused_assertion("--corrupt-sig"));
    NC_CHECK(refused_assertion("", "https://evil.example"));
    NC_CHECK(refused_assertion("--rp other.example"));
    NC_CHECK(refused_assertion("--no-up"));
    NC_CHECK(refused_assertion("--type webauthn.create"));
    NC_CHECK(refused_assertion("--cross-origin"));
    NC_CHECK(refused_assertion("--counter 1")); // a counter that went back: a cloned device
    NC_CHECK(refused_assertion("--counter 2"));
    {
        // The wrong challenge, the wrong credential, and a person not verified when it is needed.
        const std::string next = random_challenge();
        const auto answer = response_of(device.make("get", next), false);
        NC_CHECK(answer.has_value());
        if (answer) {
            NC_CHECK(!wa::verify_assertion(rp, device.stored, random_challenge(), *answer, false)
                          .has_value());
            wa::Credential other = device.stored;
            other.id = "another credential";
            NC_CHECK(!wa::verify_assertion(rp, other, next, *answer, false).has_value());
            wa::Credential key_of_another_kind = device.stored;
            key_of_another_kind.algorithm = algorithm == "es256" ? -257 : -7;
            NC_CHECK(
                !wa::verify_assertion(rp, key_of_another_kind, next, *answer, false).has_value()
            );
        }
        const std::string weak_challenge = random_challenge();
        const auto weak = response_of(device.make("get", weak_challenge, "--no-uv"), false);
        NC_CHECK(weak.has_value());
        if (weak) {
            wa::Credential current = device.stored;
            NC_CHECK(!wa::verify_assertion(rp, current, weak_challenge, *weak, true).has_value());
        }
    }
    fs::remove_all(dir);
}

void test_encoding()
{
    NC_CHECK_EQ(wa::base64url_encode(std::string("\xfb\xff\xfe", 3)), "-__-");
    NC_CHECK_EQ(*wa::base64url_decode("-__-"), std::string("\xfb\xff\xfe", 3));
    NC_CHECK(!wa::base64url_decode("+//+").has_value()); // the standard alphabet is not url-safe
    NC_CHECK(!wa::base64url_decode("AA==").has_value()); // no padding
    NC_CHECK(!wa::base64url_decode("A").has_value());
    NC_CHECK(wa::base64url_decode("").has_value());
    // A credential whose id and rawId differ, or that is not a public key credential.
    NC_CHECK(!wa::parse_client_response("[]", true).has_value());
    NC_CHECK(
        !wa::parse_client_response(
             R"({"id":"AA","rawId":"AQ","type":"public-key","response":{"clientDataJSON":"e30","attestationObject":"oA"}})",
             true
        )
             .has_value()
    );
    NC_CHECK(
        !wa::parse_client_response(
             R"({"id":"AQ","rawId":"AQ","type":"password","response":{"clientDataJSON":"e30","attestationObject":"oA"}})",
             true
        )
             .has_value()
    );
    NC_CHECK(
        wa::parse_client_response(
            R"({"id":"AQ","rawId":"AQ","type":"public-key","response":{"clientDataJSON":"e30","attestationObject":"oA"}})",
            true
        )
            .has_value()
    );
}

/// The whole thing through the server: register a device, sign in with it, and the ways that must
/// not work.
void test_flow()
{
    const std::string dir = temp_dir("flow");
    nc::Kernel kernel{nc::Config::parse(
                          "data_dir = " + dir +
                          "\n[users]\npbkdf2_iterations = 3\n[webauthn]\nrp_id = " + RP +
                          "\norigins = " + ORIGIN + "\n"
    )
                          .value()};
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"webauthn", "tokens", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::setenv("OC_PASS", "bob password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"bob"}, out), 0);
    ::unsetenv("OC_PASS");
    const auto call = [&](const std::string& method,
                          const std::string& path,
                          const std::string& body = {},
                          const std::string& credentials = {})
    {
        Request request{std::string{method}, std::string{path}};
        request.set_body(std::string{body});
        if (!credentials.empty()) {
            request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
        }
        return kernel.handle(std::move(request));
    };
    const std::string alice = "alice:alice password";
    const std::string bob = "bob:bob password";
    const std::string registration = "/settings/api/personal/webauthn/registration";
    const auto challenge_in = [](const Response& options)
    {
        const auto json = nc::util::Json::parse(options.get_body());
        NC_CHECK(json.has_value());
        return json ? *wa::base64url_decode((*json)["challenge"].string()) : std::string{};
    };
    const auto register_device = [&](Device& device,
                                     const std::string& who,
                                     const std::string& name,
                                     const std::string& flags = {})
    {
        const Response options = call("GET", registration, {}, who);
        NC_CHECK_EQ(options.get_status(), 200);
        const std::string challenge = challenge_in(options);
        const std::string credential = device.make("register", challenge, flags);
        return call(
            "POST",
            registration,
            nc::util::form_encode({{"name", name}, {"data", credential}}),
            who
        );
    };

    // Not without being signed in.
    NC_CHECK_EQ(call("GET", registration).get_status(), 401);
    const Response options = call("GET", registration, {}, alice);
    NC_CHECK_EQ(options.get_status(), 200);
    {
        const auto json = nc::util::Json::parse(options.get_body());
        NC_CHECK(json.has_value());
        if (json) {
            NC_CHECK_EQ((*json)["rp"]["id"].string(), RP);
            NC_CHECK_EQ((*json)["attestation"].string(), "none");
            NC_CHECK_EQ((*json)["user"]["name"].string(), "alice");
            NC_CHECK_EQ((*json)["pubKeyCredParams"].items().size(), 3U);
            NC_CHECK_EQ(wa::base64url_decode((*json)["challenge"].string())->size(), 32U);
        }
    }

    Device laptop{dir, "laptop", "es256"};
    Device phone{dir, "phone", "ed25519"};
    Device stranger{dir, "bobs", "rs256"};
    NC_CHECK_EQ(register_device(laptop, alice, "Laptop").get_status(), 200);
    // The same device twice is refused; so is one that needs a name, and a stale challenge.
    NC_CHECK_EQ(register_device(laptop, alice, "Laptop again").get_status(), 409);
    NC_CHECK_EQ(register_device(phone, alice, "").get_status(), 400);
    {
        const std::string challenge = challenge_in(call("GET", registration, {}, alice));
        const std::string credential = phone.make("register", challenge);
        const std::string form = nc::util::form_encode({{"name", "Phone"}, {"data", credential}});
        // Somebody else cannot finish the registration that alice started.
        NC_CHECK_EQ(call("POST", registration, form, bob).get_status(), 400);
        // Not even alice, afterwards: the challenge is used up by the attempt.
        NC_CHECK_EQ(call("POST", registration, form, alice).get_status(), 400);
        // A challenge nobody issued.
        const std::string invented = phone.make("register", random_challenge());
        NC_CHECK_EQ(
            call(
                "POST",
                registration,
                nc::util::form_encode({{"name", "Phone"}, {"data", invented}}),
                alice
            )
                .get_status(),
            400
        );
    }
    NC_CHECK_EQ(
        register_device(phone, alice, "Phone", "--origin https://evil.example").get_status(),
        400
    );
    NC_CHECK_EQ(register_device(phone, alice, "Phone").get_status(), 200);
    NC_CHECK_EQ(register_device(stranger, bob, "Bob's key").get_status(), 200);
    // JSON bodies work as well as forms.
    {
        Device json_device{dir, "json", "es256"};
        const std::string challenge = challenge_in(call("GET", registration, {}, alice));
        std::string credential = json_device.make("register", challenge);
        while (!credential.empty() && (credential.back() == '\n' || credential.back() == '\r')) {
            credential.pop_back();
        }
        NC_CHECK_EQ(
            call(
                "POST",
                registration,
                R"({"name":"JSON","data":")" + nc::util::json_escape(credential) + "\"}",
                alice
            )
                .get_status(),
            200
        );
    }
    const Response devices = call("GET", registration + "s", {}, alice);
    NC_CHECK_EQ(devices.get_status(), 200);
    NC_CHECK(devices.get_body().find("Laptop") != std::string::npos);
    NC_CHECK(devices.get_body().find("Phone") != std::string::npos);
    NC_CHECK(devices.get_body().find("Bob's key") == std::string::npos);

    // Signing in: start, answer, finish. The answer carries an app password that works.
    const auto start = [&](const std::string& login)
    {
        return call("POST", "/login/webauthn/start", nc::util::form_encode({{"loginName", login}}));
    };
    const auto finish = [&](const std::string& credential)
    {
        return call(
            "POST",
            "/login/webauthn/finish",
            nc::util::form_encode({{"data", credential}})
        );
    };
    const Response begun = start("alice");
    NC_CHECK_EQ(begun.get_status(), 200);
    {
        const auto json = nc::util::Json::parse(begun.get_body());
        NC_CHECK(json.has_value());
        if (json) {
            NC_CHECK_EQ((*json)["rpId"].string(), RP);
            NC_CHECK_EQ((*json)["allowCredentials"].items().size(), 3U); // laptop, phone, JSON
            NC_CHECK_EQ((*json)["userVerification"].string(), "required");
        }
    }
    const std::string challenge = challenge_in(begun);
    const std::string answer = laptop.make("get", challenge);
    const Response signed_in = finish(answer);
    NC_CHECK_EQ(signed_in.get_status(), 200);
    std::string token;
    {
        const auto json = nc::util::Json::parse(signed_in.get_body());
        NC_CHECK(json.has_value());
        if (json) {
            NC_CHECK_EQ((*json)["user"].string(), "alice");
            token = (*json)["token"].string();
        }
    }
    NC_CHECK(!token.empty());
    NC_CHECK_EQ(
        call("GET", "/ocs/v2.php/cloud/apppasswords", {}, "alice:" + token).get_status(),
        200
    );
    // The answer is good once.
    NC_CHECK_EQ(finish(answer).get_status(), 401);

    // Every way that must not sign in.
    const auto refused_answer = [&](Device& device,
                                    const std::string& login,
                                    const std::string& flags = {},
                                    const std::string& origin = ORIGIN)
    {
        const std::string next = challenge_in(start(login));
        return finish(device.make("get", next, flags, origin)).get_status() == 401;
    };
    NC_CHECK(refused_answer(laptop, "alice", "--corrupt-sig"));
    NC_CHECK(refused_answer(laptop, "alice", "", "https://evil.example"));
    NC_CHECK(refused_answer(laptop, "alice", "--counter 1")); // a counter that went back
    NC_CHECK(refused_answer(stranger, "alice"));              // bob's device, alice's challenge
    NC_CHECK(refused_answer(laptop, "bob"));                  // alice's device, bob's challenge
    NC_CHECK(refused_answer(laptop, "nobody"));               // an account that does not exist
    NC_CHECK_EQ(finish(laptop.make("get", random_challenge())).get_status(), 401);
    NC_CHECK_EQ(finish("not json").get_status(), 400);
    NC_CHECK_EQ(finish("{}").get_status(), 400);
    // An account that does not exist gets options like any other, without devices.
    const Response nobody = start("nobody");
    NC_CHECK_EQ(nobody.get_status(), 200);
    NC_CHECK(nobody.get_body().find("\"allowCredentials\":[]") != std::string::npos);
    // A challenge for registering cannot be used to sign in.
    {
        const std::string for_registration = challenge_in(call("GET", registration, {}, alice));
        NC_CHECK_EQ(finish(laptop.make("get", for_registration)).get_status(), 401);
    }
    // The device still works after the failures (they used up challenges, not the device), and
    // after a good sign-in the next one needs a new challenge.
    NC_CHECK(!refused_answer(laptop, "alice"));
    NC_CHECK(!refused_answer(phone, "alice"));

    // A removed device cannot sign in; another account cannot remove it.
    std::string laptop_id;
    {
        const auto list =
            nc::util::Json::parse(call("GET", registration + "s", {}, alice).get_body());
        NC_CHECK(list.has_value());
        if (list) {
            for (const nc::util::Json& device: list->items()) {
                if (device["name"].string() == "Laptop") {
                    laptop_id = std::to_string(static_cast<long long>(device["id"].number()));
                }
            }
        }
    }
    NC_CHECK(!laptop_id.empty());
    NC_CHECK_EQ(call("DELETE", registration + "/" + laptop_id, {}, bob).get_status(), 404);
    NC_CHECK_EQ(call("DELETE", registration + "/" + laptop_id, {}, alice).get_status(), 200);
    NC_CHECK(refused_answer(laptop, "alice"));
    NC_CHECK(!refused_answer(phone, "alice"));

    // An account that is removed takes its devices along.
    NC_CHECK_EQ(kernel.run_command("user:delete", {"bob"}, out), 0);
    NC_CHECK(refused_answer(stranger, "bob"));
    kernel.stop();
    fs::remove_all(dir);
}

} // namespace

int main()
{
    test_encoding();
    if (!have_python()) {
        std::fprintf(
            stderr,
            "skipping the WebAuthn tests: python3 with cbor2 and cryptography is missing\n"
        );
        return NC_TEST_RESULT();
    }
    // The authenticator is itself checked against Yubico's server code where that is installed.
    {
        const std::string probe = python() + " -c 'import fido2' >/dev/null 2>&1";
        if (std::system(probe.c_str()) == 0) {
            for (const char* algorithm: {"es256", "rs256", "ed25519"}) {
                NC_CHECK(
                    run(std::string{"selfcheck "} + algorithm).find("fido2 accepted") !=
                    std::string::npos
                );
            }
        } else {
            std::fprintf(
                stderr,
                "the python fido2 package is missing: authenticator not cross-checked\n"
            );
        }
    }
    test_algorithm("es256", -7);
    test_algorithm("rs256", -257);
    test_algorithm("ed25519", -8);
    test_flow();
    return NC_TEST_RESULT();
}
