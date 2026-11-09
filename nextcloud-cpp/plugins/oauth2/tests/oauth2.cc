#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"

#include <chrono>
#include <cstdlib>
#include <filesystem>

namespace {

using nc::http::Request;
using nc::http::Response;

Request signed_in(
    std::string method,
    std::string path,
    std::string query,
    std::string body,
    const std::string& credentials
)
{
    Request request{
        std::move(method),
        std::move(path),
        std::move(query),
        std::move(body),
        std::string{},
        {},
        {}
    };
    request.add_header("Authorization", "Basic " + nc::util::base64_encode(credentials));
    return request;
}

std::string between(const std::string& text, const std::string& begin, const std::string& end)
{
    const std::size_t start = text.find(begin);
    if (start == std::string::npos) {
        return {};
    }
    const std::size_t from = start + begin.size();
    return text.substr(from, text.find(end, from) - from);
}

std::string base64url(const std::string& bytes)
{
    std::string out = nc::util::base64_encode(bytes);
    for (char& letter: out) {
        letter = letter == '+' ? '-' : letter == '/' ? '_' : letter;
    }
    while (!out.empty() && out.back() == '=') {
        out.pop_back();
    }
    return out;
}

} // namespace

int main()
{
    const std::string dir =
        (std::filesystem::temp_directory_path() / ("nc-oauth-" + nc::util::random_hex(4))).string();
    nc::Kernel kernel{
        nc::Config::parse("data_dir = " + dir + "\n[users]\npbkdf2_iterations = 3\n").value()
    };
    kernel.get_logger().set_sink({});
    for (const char* plugin: {"oauth2", "twofactor", "users", "db"}) {
        NC_CHECK(kernel
                     .add_plugin_library(std::string{"plugins/"} + plugin + "/lib" + plugin + ".so")
                     .has_value());
    }
    NC_CHECK(kernel.start().has_value());
    std::string out;
    ::setenv("OC_PASS", "alice password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"alice"}, out), 0);
    ::unsetenv("OC_PASS");
    const std::string alice = "alice:alice password";
    const std::string redirect = "https://app.example.org/callback";

    // The administrator registers a client; the secret is shown once.
    NC_CHECK_EQ(kernel.run_command("oauth2:add", {"Notes app", "javascript:alert(1)"}, out), 1);
    NC_CHECK_EQ(kernel.run_command("oauth2:add", {"Notes app", redirect + "#frag"}, out), 1);
    NC_CHECK_EQ(kernel.run_command("oauth2:add", {"Notes app", redirect}, out), 0);
    const std::string client_id = between(out, "client_id: ", "\n");
    const std::string secret = between(out, "client_secret: ", "\n");
    NC_CHECK_EQ(client_id.size(), std::size_t{32});
    NC_CHECK_EQ(secret.size(), std::size_t{64});
    NC_CHECK_EQ(kernel.run_command("oauth2:list", {}, out), 0);
    NC_CHECK(out.find(client_id) != std::string::npos && out.find(secret) == std::string::npos);

    const auto authorize =
        [&](const std::string& query, const std::string& credentials = "alice:alice password")
    {
        return kernel.handle(
            signed_in("GET", "/index.php/apps/oauth2/authorize", query, "", credentials)
        );
    };
    const auto exchange = [&](const std::string& body)
    {
        return kernel.handle(Request{
            "POST",
            "/index.php/apps/oauth2/api/v1/token",
            "",
            std::string{body},
            "",
            {},
            {}
        });
    };
    const std::string base = "response_type=code&client_id=" + client_id +
                             "&redirect_uri=" + nc::util::form_encode({{"", redirect}}).substr(1) +
                             "&state=xyz";

    // Authorizing needs a signed-in person, a known client and exactly the registered address.
    NC_CHECK_EQ(
        kernel.handle(Request{"GET", "/index.php/apps/oauth2/authorize"}).get_status(),
        401
    );
    NC_CHECK_EQ(
        authorize("response_type=code&client_id=nobody&redirect_uri=" + redirect).get_status(),
        400
    );
    NC_CHECK_EQ(
        authorize(
            "response_type=code&client_id=" + client_id +
            "&redirect_uri=https://evil.example.org/cb"
        )
            .get_status(),
        400
    );
    const Response denied = authorize(
        "response_type=token&client_id=" + client_id +
        "&redirect_uri=" + nc::util::form_encode({{"", redirect}}).substr(1)
    );
    NC_CHECK_EQ(denied.get_status(), 302);
    NC_CHECK(
        std::string(denied.header("Location")).find("error=unsupported_response_type") !=
        std::string::npos
    );

    const Response granted = authorize(base);
    NC_CHECK_EQ(granted.get_status(), 302);
    const std::string location{granted.header("Location")};
    NC_CHECK(location.starts_with(redirect + "?code="));
    NC_CHECK(location.find("&state=xyz") != std::string::npos);
    const std::string code = between(location, "code=", "&");

    // The code is exchanged once, for the right client, with its secret and the same address.
    const std::string redirect_form =
        "&redirect_uri=" + nc::util::form_encode({{"", redirect}}).substr(1);
    NC_CHECK_EQ(
        exchange(
            "grant_type=authorization_code&code=" + code + "&client_id=" + client_id +
            "&client_secret=wrong" + redirect_form
        )
            .get_status(),
        401
    );
    NC_CHECK_EQ(
        exchange(
            "grant_type=authorization_code&code=" + code + "&client_id=" + client_id +
            "&client_secret=" + secret + "&redirect_uri=https://evil.example.org/cb"
        )
            .get_status(),
        400
    );
    // A failed attempt with the right client burns the code: whoever tries again needs a new one.
    NC_CHECK_EQ(
        exchange(
            "grant_type=authorization_code&code=" + code + "&client_id=" + client_id +
            "&client_secret=" + secret + redirect_form
        )
            .get_status(),
        400
    );
    const std::string fresh =
        between(std::string(authorize(base).header("Location")), "code=", "&");
    const Response issued = exchange(
        "grant_type=authorization_code&code=" + fresh + "&client_id=" + client_id +
        "&client_secret=" + secret + redirect_form
    );
    NC_CHECK_EQ(issued.get_status(), 200);
    NC_CHECK_EQ(std::string(issued.header("Cache-Control")), "no-store");
    const std::string access = between(issued.get_body(), "\"access_token\":\"", "\"");
    const std::string refresh = between(issued.get_body(), "\"refresh_token\":\"", "\"");
    NC_CHECK(
        issued.get_body().find("\"token_type\":\"Bearer\"") != std::string::npos &&
        issued.get_body().find("\"user_id\":\"alice\"") != std::string::npos
    );
    NC_CHECK_EQ(
        exchange(
            "grant_type=authorization_code&code=" + fresh + "&client_id=" + client_id +
            "&client_secret=" + secret + redirect_form
        )
            .get_status(),
        400
    ); // used up

    // The access token signs requests in, as a Bearer token.
    const auto bearer = [&](const std::string& token)
    {
        Request request{"GET", "/ocs/v2.php/cloud/user"};
        request.add_header("Authorization", "Bearer " + token);
        return kernel.handle(std::move(request));
    };
    const Response me = bearer(access);
    NC_CHECK_EQ(me.get_status(), 200);
    NC_CHECK(me.get_body().find("\"id\":\"alice\"") != std::string::npos);
    NC_CHECK_EQ(bearer("not-a-token").get_status(), 401);
    NC_CHECK_EQ(bearer(refresh).get_status(), 401); // a refresh token is not an access token
    // The database only has digests.
    NC_CHECK_EQ(
        kernel.get_services()
            .call(
                "db.query",
                "sql=SELECT+COUNT%28*%29+AS+n+FROM+nc_oauth_tokens+WHERE+access_digest+%3D+%"
                "27" +
                    access + "%27"
            )
            .get_body(),
        "n=0\n"
    );

    // Refreshing hands out a new pair and ends the old one; an old refresh token does not work
    // again.
    const Response renewed = exchange(
        "grant_type=refresh_token&refresh_token=" + refresh + "&client_id=" + client_id +
        "&client_secret=" + secret
    );
    NC_CHECK_EQ(renewed.get_status(), 200);
    const std::string access2 = between(renewed.get_body(), "\"access_token\":\"", "\"");
    NC_CHECK(access2 != access);
    NC_CHECK_EQ(bearer(access).get_status(), 401);
    NC_CHECK_EQ(bearer(access2).get_status(), 200);
    NC_CHECK_EQ(
        exchange(
            "grant_type=refresh_token&refresh_token=" + refresh + "&client_id=" + client_id +
            "&client_secret=" + secret
        )
            .get_status(),
        400
    );
    NC_CHECK_EQ(
        exchange("grant_type=password&client_id=" + client_id + "&client_secret=" + secret)
            .get_status(),
        400
    );

    // PKCE: the verifier has to match the challenge sent at the start.
    const std::string verifier = "a-long-random-string-the-client-keeps-secret-0123456789";
    const std::string challenge = base64url(nc::util::sha256(verifier));
    const std::string pkce_code = between(
        std::string(authorize(base + "&code_challenge=" + challenge + "&code_challenge_method=S256")
                        .header("Location")),
        "code=",
        "&"
    );
    NC_CHECK_EQ(
        exchange(
            "grant_type=authorization_code&code=" + pkce_code + "&client_id=" + client_id +
            "&client_secret=" + secret + redirect_form
        )
            .get_status(),
        400
    ); // no verifier
    const std::string pkce_code2 = between(
        std::string(authorize(base + "&code_challenge=" + challenge + "&code_challenge_method=S256")
                        .header("Location")),
        "code=",
        "&"
    );
    NC_CHECK_EQ(
        exchange(
            "grant_type=authorization_code&code=" + pkce_code2 + "&client_id=" + client_id +
            "&client_secret=" + secret + redirect_form + "&code_verifier=wrong"
        )
            .get_status(),
        400
    );
    const std::string pkce_code3 = between(
        std::string(authorize(base + "&code_challenge=" + challenge + "&code_challenge_method=S256")
                        .header("Location")),
        "code=",
        "&"
    );
    NC_CHECK_EQ(
        exchange(
            "grant_type=authorization_code&code=" + pkce_code3 + "&client_id=" + client_id +
            "&client_secret=" + secret + redirect_form + "&code_verifier=" + verifier
        )
            .get_status(),
        200
    );
    NC_CHECK(
        std::string(
            authorize(base + "&code_challenge=" + challenge + "&code_challenge_method=plain")
                .header("Location")
        )
            .find("error=invalid_request") != std::string::npos
    );

    // Expiry, and the end of an account or of a client, end the access.
    NC_CHECK_EQ(
        kernel.get_services()
            .call("db.exec", "sql=UPDATE+nc_oauth_tokens+SET+expires+%3D+1")
            .get_status(),
        200
    );
    NC_CHECK_EQ(bearer(access2).get_status(), 401);
    const Response again = exchange(
        "grant_type=authorization_code&code=" +
        between(std::string(authorize(base).header("Location")), "code=", "&") +
        "&client_id=" + client_id + "&client_secret=" + secret + redirect_form
    );
    const std::string access3 = between(again.get_body(), "\"access_token\":\"", "\"");
    NC_CHECK_EQ(bearer(access3).get_status(), 200);
    NC_CHECK_EQ(kernel.run_command("oauth2:remove", {client_id}, out), 0);
    NC_CHECK_EQ(bearer(access3).get_status(), 401);
    NC_CHECK_EQ(kernel.run_command("oauth2:remove", {client_id}, out), 1);

    kernel.stop();
    std::filesystem::remove_all(dir);
    return NC_TEST_RESULT();
}
