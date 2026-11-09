/**
 * @file users_plugin.cc
 * @brief The accounts plugin: sign-in for the whole runner (`auth.authenticate`), the OCS
 * provisioning API (`/ocs/v2.php/cloud/users`) and the `user:*` commands. Counterpart of
 * Nextcloud's `lib/private/User` and `apps/provisioning_api`.
 */
#include "nextcloud/plugin.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"
#include "user_store.h"

#include <cstdlib>
#include <memory>

namespace {

using nc::http::Request;
using nc::http::Response;
using nc::users::User;
using nc::users::UserStore;

std::string json_string(std::string_view text)
{
    return "\"" + nc::util::json_escape(text) + "\"";
}

std::string user_json(const User& user)
{
    return R"({"id":)" + json_string(user.get_id()) + R"(,"enabled":)" +
           (user.is_enabled() ? "true" : "false") + R"(,"admin":)" +
           (user.is_admin() ? "true" : "false") + R"(,"email":)" + json_string(user.get_email()) +
           R"(,"displayname":)" + json_string(user.shown_name()) + "}";
}

Response ok(std::string_view data = "{}")
{
    return nc::http::ocs(200, "OK", data);
}

Response failure(int status, std::string_view message)
{
    return nc::http::ocs(status, message, "{}");
}

/// A field from the form body, falling back to the query string (OCS clients use either).
std::string
field(const Request& request, const std::vector<nc::http::Header>& form, std::string_view name)
{
    std::string value = nc::util::form_value(form, name);
    return value.empty() ? request.query_value(name) : value;
}

class UsersPlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "users";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Accounts, sign-in and the provisioning API";
    }

    void on_load(nc::Host& host) override
    {
        const std::string data_dir = host.config("data_dir", "data");
        const auto iterations = static_cast<std::uint32_t>(
            std::strtoul(host.config("pbkdf2_iterations", "10000").c_str(), nullptr, 10)
        );
        const auto min_password = static_cast<std::size_t>(
            std::strtoul(host.config("min_password_length", "8").c_str(), nullptr, 10)
        );
        m_store = std::make_unique<UserStore>(data_dir + "/users.db", iterations, min_password);
        if (auto loaded = m_store->load(); !loaded) {
            throw std::runtime_error(loaded.error());
        }
        UserStore& store = *m_store;

        // ---- services other plugins and the kernel use ----------------------------------------
        host.add_service(
            "auth.authenticate",
            [&store](std::string_view args)
            {
                const std::size_t colon = args.find(':');
                if (colon == std::string_view::npos) {
                    return Response::text(401, "");
                }
                const auto id = store.authenticate(args.substr(0, colon), args.substr(colon + 1));
                return id ? Response::text(200, std::string{*id}) : Response::text(401, "");
            }
        );
        // id, displayname, email: make sure the account exists (a person who signs in through a
        // directory). New accounts get a random password nobody knows, so only the directory can
        // sign them in.
        host.add_service(
            "users.ensure",
            [&store, &host](std::string_view args)
            {
                const auto form = nc::util::parse_form(args);
                const std::string id = nc::util::form_value(form, "id");
                if (store.find(id)) {
                    return Response::text(200, "exists");
                }
                std::string email = nc::util::form_value(form, "email");
                if (!email.empty() && !UserStore::valid_email(email)) {
                    email.clear(); // a bad address in the directory must not stop a sign-in
                }
                auto created = store.create(
                    id,
                    nc::util::random_hex(16),
                    nc::util::form_value(form, "displayname"),
                    email,
                    false
                );
                if (!created) {
                    return Response::text(400, created.error());
                }
                host.publish(
                    "user.created",
                    nc::util::form_encode(
                        {{"id", id},
                         {"email", email},
                         {"displayname", nc::util::form_value(form, "displayname")}}
                    )
                );
                return Response::text(200, "created");
            }
        );
        host.add_service(
            "users.get",
            [&store](std::string_view args)
            {
                const auto user = store.find(args);
                return user ? Response::json(200, user_json(*user))
                            : Response::text(404, "no such user");
            }
        );
        // Every enabled account, one per line: "id<TAB>display name<TAB>e-mail address".
        host.add_service(
            "users.directory",
            [&store](std::string_view)
            {
                std::string out;
                for (const User& user: store.list()) {
                    if (user.is_enabled()) {
                        out += user.get_id() + "\t" + user.shown_name() + "\t" + user.get_email() +
                               "\n";
                    }
                }
                return Response::text(200, out);
            }
        );
        // Enabled accounts whose id or display name contains the text (without case): one per line,
        // "id<TAB>display name", at most 20, in id order.
        host.add_service(
            "users.search",
            [&store](std::string_view args)
            {
                const std::string needle = nc::util::to_lower(args);
                std::string out;
                std::size_t count = 0;
                for (const User& user: store.list()) {
                    if (count < 20 && user.is_enabled() &&
                        (nc::util::to_lower(user.get_id()).find(needle) != std::string::npos ||
                         nc::util::to_lower(user.get_display_name()).find(needle) !=
                             std::string::npos)) {
                        out += user.get_id() + "\t" + user.get_display_name() + "\n";
                        ++count;
                    }
                }
                return Response::text(200, out);
            }
        );
        // The id of the enabled account with this e-mail address (compared without case), or 404.
        host.add_service(
            "users.by_email",
            [&store](std::string_view args)
            {
                const std::string wanted = nc::util::to_lower(args);
                for (const User& user: store.list()) {
                    if (user.is_enabled() && !user.get_email().empty() &&
                        nc::util::to_lower(user.get_email()) == wanted) {
                        return Response::text(200, user.get_id());
                    }
                }
                return Response::text(404, "no such address");
            }
        );
        // The ids of the enabled administrators, one per line.
        host.add_service(
            "users.list_admins",
            [&store](std::string_view)
            {
                std::string out;
                for (const User& user: store.list()) {
                    if (user.is_admin() && user.is_enabled()) {
                        out += user.get_id() + "\n";
                    }
                }
                return Response::text(200, out);
            }
        );
        // 200 when the account exists and is an administrator, 404 otherwise.
        host.add_service(
            "users.is_admin",
            [&store](std::string_view args)
            {
                const auto user = store.find(args);
                return user && user->is_admin() && user->is_enabled()
                           ? Response::text(200, "admin")
                           : Response::text(404, "not an administrator");
            }
        );
        host.add_service(
            "users.email",
            [&store](std::string_view args)
            {
                const auto user = store.find(args);
                return user ? Response::text(200, user->get_email())
                            : Response::text(404, "no such user");
            }
        );

        // ---- provisioning API -----------------------------------------------------------------
        host.add_route(
            "GET",
            "/ocs/v2.php/cloud/user",
            [&store](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const auto user = store.find(request.get_user());
                return user ? ok(user_json(*user)) : failure(404, "User not found");
            }
        );

        host.add_route(
            "GET",
            "/ocs/v2.php/cloud/users",
            [&store](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                if (!is_admin(store, request.get_user())) {
                    return failure(403, "Forbidden");
                }
                std::string data = R"({"users":[)";
                bool first = true;
                for (const User& user: store.list()) {
                    data += first ? "" : ",";
                    first = false;
                    data += json_string(user.get_id());
                }
                return ok(data + "]}");
            }
        );

        host.add_route(
            "POST",
            "/ocs/v2.php/cloud/users",
            [&store, &host](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                if (!is_admin(store, request.get_user())) {
                    return failure(403, "Forbidden");
                }
                const auto form = nc::util::parse_form(request.get_body());
                const std::string id = field(request, form, "userid");
                auto created = store.create(
                    id,
                    field(request, form, "password"),
                    field(request, form, "displayName"),
                    field(request, form, "email"),
                    field(request, form, "admin") == "true"
                );
                if (!created) {
                    return failure(
                        created.error().find("already exists") != std::string::npos ? 409 : 400,
                        created.error()
                    );
                }
                publish_created(host, *store.find(id));
                return ok(R"({"id":)" + json_string(id) + "}");
            }
        );

        host.add_route(
            "GET",
            "/ocs/v2.php/cloud/users/{userid}",
            [&store](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const std::string target{request.param("userid")};
                if (target != request.get_user() && !is_admin(store, request.get_user())) {
                    return failure(403, "Forbidden");
                }
                const auto user = store.find(target);
                return user ? ok(user_json(*user)) : failure(404, "User not found");
            }
        );

        host.add_route(
            "PUT",
            "/ocs/v2.php/cloud/users/{userid}",
            [&store](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                const std::string target{request.param("userid")};
                const bool admin = is_admin(store, request.get_user());
                if (target != request.get_user() && !admin) {
                    return failure(403, "Forbidden");
                }
                const auto form = nc::util::parse_form(request.get_body());
                const std::string key = field(request, form, "key");
                const std::string value = field(request, form, "value");
                if (!store.find(target)) {
                    return failure(404, "User not found");
                }
                nc::users::UserStore::Result<void> done =
                    nc::util::unexpected<std::string>{"unknown key " + key};
                if (key == "email") {
                    done = store.set_email(target, value);
                } else if (key == "displayname") {
                    done = store.set_display_name(target, value);
                } else if (key == "password") {
                    done = store.set_password(target, value);
                } else if (key == "enabled") {
                    done =
                        admin && target != request.get_user()
                            ? store.set_enabled(target, value == "true")
                            : nc::users::UserStore::Result<void>{nc::util::unexpected<std::string>{
                                  "only an administrator can enable or disable another account"
                              }};
                }
                return done ? ok() : failure(400, done.error());
            }
        );

        host.add_route(
            "DELETE",
            "/ocs/v2.php/cloud/users/{userid}",
            [&store, &host](const Request& request)
            {
                if (request.get_user().empty()) {
                    return nc::http::unauthorized();
                }
                if (!is_admin(store, request.get_user())) {
                    return failure(403, "Forbidden");
                }
                const std::string target{request.param("userid")};
                if (target == request.get_user()) {
                    return failure(400, "You cannot delete your own account");
                }
                auto removed = store.remove(target);
                if (!removed) {
                    return failure(404, removed.error());
                }
                host.publish("user.deleted", nc::util::form_encode({{"id", target}}));
                return ok();
            }
        );

        // ---- command line ---------------------------------------------------------------------
        host.add_command(
            "user:add",
            "Adds an account: user:add <id> [--display-name=NAME] [--email=ADDRESS] [--admin] "
            "(password in OC_PASS)",
            [&store, &host](const std::vector<std::string>& args, std::string& out)
            {
                if (args.empty()) {
                    out =
                        "usage: user:add <id> [--display-name=NAME] [--email=ADDRESS] [--admin]\n";
                    return 1;
                }
                const char* password = std::getenv("OC_PASS");
                if (password == nullptr) {
                    out = "set the password in the environment variable OC_PASS\n";
                    return 1;
                }
                std::string display_name;
                std::string email;
                bool admin = false;
                for (std::size_t index = 1; index < args.size(); ++index) {
                    if (nc::util::starts_with(args[index], "--display-name=")) {
                        display_name = args[index].substr(15);
                    } else if (nc::util::starts_with(args[index], "--email=")) {
                        email = args[index].substr(8);
                    } else if (args[index] == "--admin") {
                        admin = true;
                    } else {
                        out = "unknown option " + args[index] + "\n";
                        return 1;
                    }
                }
                auto created = store.create(args[0], password, display_name, email, admin);
                if (!created) {
                    out = created.error() + "\n";
                    return 1;
                }
                publish_created(host, *store.find(args[0]));
                out = "The account \"" + args[0] + "\" was created successfully\n";
                return 0;
            }
        );

        host.add_command(
            "user:list",
            "Lists the accounts",
            [&store](const std::vector<std::string>&, std::string& out)
            {
                for (const User& user: store.list()) {
                    out += user.get_id() + "\t" + user.shown_name() + "\t" + user.get_email() +
                           (user.is_admin() ? "\tadmin" : "") +
                           (user.is_enabled() ? "" : "\tdisabled") + "\n";
                }
                return 0;
            }
        );

        host.add_command(
            "user:delete",
            "Deletes an account: user:delete <id>",
            [&store, &host](const std::vector<std::string>& args, std::string& out)
            {
                if (args.size() != 1) {
                    out = "usage: user:delete <id>\n";
                    return 1;
                }
                auto removed = store.remove(args[0]);
                if (!removed) {
                    out = removed.error() + "\n";
                    return 1;
                }
                host.publish("user.deleted", nc::util::form_encode({{"id", args[0]}}));
                out = "The account \"" + args[0] + "\" was deleted\n";
                return 0;
            }
        );

        host.add_command(
            "user:resetpassword",
            "Sets a new password: user:resetpassword <id> (password in OC_PASS)",
            [&store](const std::vector<std::string>& args, std::string& out)
            {
                const char* password = std::getenv("OC_PASS");
                if (args.size() != 1 || password == nullptr) {
                    out = "usage: OC_PASS=... user:resetpassword <id>\n";
                    return 1;
                }
                auto done = store.set_password(args[0], password);
                out = done ? "The password of \"" + args[0] + "\" was changed\n"
                           : done.error() + "\n";
                return done ? 0 : 1;
            }
        );

        for (const bool enable: {true, false}) {
            host.add_command(
                enable ? "user:enable" : "user:disable",
                enable ? "Enables an account: user:enable <id>"
                       : "Disables an account: user:disable <id>",
                [&store, enable](const std::vector<std::string>& args, std::string& out)
                {
                    if (args.size() != 1) {
                        out = "usage: user:enable|disable <id>\n";
                        return 1;
                    }
                    auto done = store.set_enabled(args[0], enable);
                    out = done ? "done\n" : done.error() + "\n";
                    return done ? 0 : 1;
                }
            );
        }
    }

private:
    static bool is_admin(const UserStore& store, std::string_view id)
    {
        const auto user = store.find(id);
        return user && user->is_admin();
    }

    static void publish_created(const nc::Host& host, const User& user)
    {
        host.publish(
            "user.created",
            nc::util::form_encode(
                {{"id", user.get_id()},
                 {"email", user.get_email()},
                 {"displayname", user.shown_name()}}
            )
        );
    }

    std::unique_ptr<UserStore> m_store{};
};

} // namespace

NC_PLUGIN(UsersPlugin)
