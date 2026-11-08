#include "user_store.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace nc::users {

namespace {

    constexpr std::chrono::minutes REMEMBER_FOR{5};

    bool clean_field(std::string_view value) noexcept
    {
        return std::ranges::none_of(
            value,
            [](char letter)
            {
                return letter == '\t' || letter == '\n' || letter == '\r' || letter == '\0';
            }
        );
    }

} // namespace

UserStore::UserStore(std::string&& file, std::uint32_t iterations, std::size_t min_password) :
    m_file{std::move(file)},
    m_iterations{std::max<std::uint32_t>(iterations, 1)},
    m_min_password{min_password},
    m_pepper{util::random_hex(16)}
{
}

bool UserStore::valid_id(std::string_view id) noexcept
{
    return !id.empty() && id.size() <= 64 && id != "." && id != ".." &&
           std::ranges::all_of(
               id,
               [](unsigned char letter)
               {
                   return std::isalnum(letter) != 0 || letter == '_' || letter == '.' ||
                          letter == '@' || letter == '-';
               }
           );
}

bool UserStore::valid_email(std::string_view email) noexcept
{
    return util::is_valid_email(email);
}

UserStore::Result<void> UserStore::check_password(std::string_view password) const
{
    if (password.size() < m_min_password) {
        return util::unexpected<Error>{
            "the password must have at least " + std::to_string(m_min_password) + " characters"
        };
    }
    if (password.size() > 1'024 || !clean_field(password)) {
        return util::unexpected<Error>{"the password contains characters that are not allowed"};
    }
    return {};
}

void UserStore::hash_into(User& user, std::string_view password) const
{
    user.set_salt(util::random_hex(16));
    user.set_iterations(m_iterations);
    user.set_hash(util::to_hex(util::pbkdf2_sha256(password, user.get_salt(), m_iterations)));
}

std::string UserStore::cache_key(const User& user, std::string_view password) const
{
    return util::to_hex(util::sha256(m_pepper + user.get_hash() + std::string(password)));
}

UserStore::Result<void> UserStore::load()
{
    const std::lock_guard lock{m_mutex};
    m_users.clear();
    m_remembered.clear();
    std::ifstream stream{m_file};
    if (!stream) {
        return {};
    }
    std::string line;
    std::size_t number = 0;
    while (std::getline(stream, line)) {
        ++number;
        if (line.empty()) {
            continue;
        }
        const std::vector<std::string> parts = util::split(line, '\t');
        if (parts.size() != 8 || !valid_id(parts[0])) {
            return util::unexpected<Error>{
                m_file + ":" + std::to_string(number) + ": damaged account line"
            };
        }
        User user{
            std::string{parts[0]},
            std::string{parts[7]},
            std::string{parts[6]},
            std::string{parts[1]},
            std::string{parts[3]},
            static_cast<std::uint32_t>(std::strtoul(parts[2].c_str(), nullptr, 10)),
            parts[4] == "1",
            parts[5] == "1"
        };
        m_users.emplace(parts[0], std::move(user));
    }
    return {};
}

UserStore::Result<void> UserStore::save_locked() const
{
    std::error_code error;
    const std::filesystem::path path{m_file};
    if (path.has_parent_path()) {
        std::filesystem::create_directories(path.parent_path(), error);
        if (error) {
            return util::unexpected<Error>{
                "cannot create " + path.parent_path().string() + ": " + error.message()
            };
        }
    }
    const std::string temporary = m_file + ".tmp";
    {
        std::ofstream stream{temporary, std::ios::trunc};
        if (!stream) {
            return util::unexpected<Error>{"cannot write " + temporary};
        }
        for (const auto& [id, user]: m_users) {
            stream << id << '\t' << user.get_salt() << '\t' << user.get_iterations() << '\t'
                   << user.get_hash() << '\t' << (user.is_enabled() ? '1' : '0') << '\t'
                   << (user.is_admin() ? '1' : '0') << '\t' << user.get_email() << '\t'
                   << user.get_display_name() << '\n';
        }
        stream.flush();
        if (!stream) {
            return util::unexpected<Error>{"cannot write " + temporary};
        }
    }
    std::filesystem::permissions(
        temporary,
        std::filesystem::perms::owner_read | std::filesystem::perms::owner_write,
        error
    );
    std::filesystem::rename(temporary, m_file, error);
    if (error) {
        return util::unexpected<Error>{"cannot replace " + m_file + ": " + error.message()};
    }
    return {};
}

UserStore::Result<void> UserStore::create(
    std::string_view id,
    std::string_view password,
    std::string_view display_name,
    std::string_view email,
    bool admin
)
{
    if (!valid_id(id)) {
        return util::unexpected<Error>{"the user id may only contain letters, digits and _ . @ -"};
    }
    if (!email.empty() && !valid_email(email)) {
        return util::unexpected<Error>{"the email address is not valid"};
    }
    if (!clean_field(display_name) || display_name.size() > 128) {
        return util::unexpected<Error>{"the display name is not valid"};
    }
    if (auto checked = check_password(password); !checked) {
        return checked;
    }
    const std::lock_guard lock{m_mutex};
    if (m_users.find(id) != m_users.end()) {
        return util::unexpected<Error>{"the user " + std::string(id) + " already exists"};
    }
    User user{std::string{id}};
    user.set_display_name(std::string{display_name});
    user.set_email(std::string{email});
    user.set_admin(admin || m_users.empty()); // the first account is the administrator
    hash_into(user, password);
    m_users.emplace(std::string{id}, std::move(user));
    if (auto saved = save_locked(); !saved) {
        m_users.erase(m_users.find(id));
        return saved;
    }
    return {};
}

UserStore::Result<void> UserStore::remove(std::string_view id)
{
    const std::lock_guard lock{m_mutex};
    const auto found = m_users.find(id);
    if (found == m_users.end()) {
        return util::unexpected<Error>{"no such user"};
    }
    User backup = found->second;
    m_users.erase(found);
    m_remembered.erase(std::string{id});
    if (auto saved = save_locked(); !saved) {
        m_users.emplace(std::string{id}, std::move(backup));
        return saved;
    }
    return {};
}

UserStore::Result<void> UserStore::set_password(std::string_view id, std::string_view password)
{
    if (auto checked = check_password(password); !checked) {
        return checked;
    }
    const std::lock_guard lock{m_mutex};
    const auto found = m_users.find(id);
    if (found == m_users.end()) {
        return util::unexpected<Error>{"no such user"};
    }
    User previous = found->second;
    hash_into(found->second, password);
    m_remembered.erase(std::string{id});
    if (auto saved = save_locked(); !saved) {
        found->second = std::move(previous);
        return saved;
    }
    return {};
}

UserStore::Result<void> UserStore::set_email(std::string_view id, std::string_view email)
{
    if (!email.empty() && !valid_email(email)) {
        return util::unexpected<Error>{"the email address is not valid"};
    }
    const std::lock_guard lock{m_mutex};
    const auto found = m_users.find(id);
    if (found == m_users.end()) {
        return util::unexpected<Error>{"no such user"};
    }
    found->second.set_email(std::string{email});
    return save_locked();
}

UserStore::Result<void>
UserStore::set_display_name(std::string_view id, std::string_view display_name)
{
    if (!clean_field(display_name) || display_name.size() > 128) {
        return util::unexpected<Error>{"the display name is not valid"};
    }
    const std::lock_guard lock{m_mutex};
    const auto found = m_users.find(id);
    if (found == m_users.end()) {
        return util::unexpected<Error>{"no such user"};
    }
    found->second.set_display_name(std::string{display_name});
    return save_locked();
}

UserStore::Result<void> UserStore::set_enabled(std::string_view id, bool enabled)
{
    const std::lock_guard lock{m_mutex};
    const auto found = m_users.find(id);
    if (found == m_users.end()) {
        return util::unexpected<Error>{"no such user"};
    }
    found->second.set_enabled(enabled);
    if (!enabled) {
        m_remembered.erase(std::string{id});
    }
    return save_locked();
}

std::optional<std::string>
UserStore::authenticate(std::string_view id, std::string_view password) const
{
    User user;
    {
        const std::lock_guard lock{m_mutex};
        const auto found = m_users.find(id);
        if (found != m_users.end()) {
            user = found->second;
            const auto remembered = m_remembered.find(id);
            if (remembered != m_remembered.end() && user.is_enabled() &&
                remembered->second.until > std::chrono::steady_clock::now() &&
                util::constant_time_equals(remembered->second.digest, cache_key(user, password))) {
                return user.get_id();
            }
        }
    }
    if (user.get_id().empty()) {
        // Spend the same time as for a real account, so the response does not tell which ids exist.
        (void)util::pbkdf2_sha256(password, "0000000000000000", m_iterations);
        return std::nullopt;
    }
    const std::string computed =
        util::to_hex(util::pbkdf2_sha256(password, user.get_salt(), user.get_iterations()));
    if (!user.is_enabled() || !util::constant_time_equals(computed, user.get_hash())) {
        return std::nullopt;
    }
    const std::lock_guard lock{m_mutex};
    m_remembered[user.get_id()] =
        Remembered{cache_key(user, password), std::chrono::steady_clock::now() + REMEMBER_FOR};
    return user.get_id();
}

std::optional<User> UserStore::find(std::string_view id) const
{
    const std::lock_guard lock{m_mutex};
    const auto found = m_users.find(id);
    return found == m_users.end() ? std::nullopt : std::optional<User>{found->second};
}

std::vector<User> UserStore::list() const
{
    const std::lock_guard lock{m_mutex};
    std::vector<User> users;
    for (const auto& [id, user]: m_users) {
        users.push_back(user);
    }
    return users;
}

std::size_t UserStore::size() const
{
    const std::lock_guard lock{m_mutex};
    return m_users.size();
}

} // namespace nc::users
