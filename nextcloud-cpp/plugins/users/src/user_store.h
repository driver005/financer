#pragma once

#include "nextcloud/util/expected.h"
#include "user.h"

#include <chrono>
#include <map>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace nc::users {

/// @brief The account database, the counterpart of `OC\User\Database` + `OC\User\Manager`.
///
/// One text file, one account per line, rewritten atomically on every change. Passwords are stored
/// as PBKDF2-HMAC-SHA-256 with a random salt. A successful login is remembered for a few minutes
/// (keyed by a digest, never the password), because the key derivation is meant to be slow and HTTP
/// basic authentication repeats it on every request.
class UserStore
{
public:
    using Error = std::string;
    template<typename Value> using Result = util::expected<Value, Error>;

    explicit UserStore(
        std::string&& file,
        std::uint32_t iterations = 10'000,
        std::size_t min_password = 8
    );

    /// @brief Reads the file; a missing file is an empty store.
    Result<void> load();

    Result<void> create(
        std::string_view id,
        std::string_view password,
        std::string_view display_name,
        std::string_view email,
        bool admin
    );
    Result<void> remove(std::string_view id);
    Result<void> set_password(std::string_view id, std::string_view password);
    Result<void> set_email(std::string_view id, std::string_view email);
    Result<void> set_display_name(std::string_view id, std::string_view display_name);
    Result<void> set_enabled(std::string_view id, bool enabled);

    /// @brief The id of the account when `password` is right and the account is enabled.
    [[nodiscard]] std::optional<std::string>
    authenticate(std::string_view id, std::string_view password) const;

    [[nodiscard]] std::optional<User> find(std::string_view id) const;
    [[nodiscard]] std::vector<User> list() const;
    [[nodiscard]] std::size_t size() const;

    [[nodiscard]] static bool valid_id(std::string_view id) noexcept;
    [[nodiscard]] static bool valid_email(std::string_view email) noexcept;

private:
    [[nodiscard]] Result<void> save_locked() const;
    [[nodiscard]] Result<void> check_password(std::string_view password) const;
    void hash_into(User& user, std::string_view password) const;
    [[nodiscard]] std::string cache_key(const User& user, std::string_view password) const;

    struct Remembered
    {
        std::string digest{};
        std::chrono::steady_clock::time_point until{};
    };

    std::string m_file{};
    std::uint32_t m_iterations{10'000};
    std::size_t m_min_password{8};
    std::string m_pepper{};
    mutable std::mutex m_mutex{};
    std::map<std::string, User, std::less<>> m_users{};
    mutable std::map<std::string, Remembered, std::less<>> m_remembered{};
};

} // namespace nc::users
