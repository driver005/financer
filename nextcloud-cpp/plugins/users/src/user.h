#pragma once

#include <cstdint>
#include <string>
#include <utility>

namespace nc::users {

/// @brief One account: what Nextcloud keeps in `oc_users` plus `oc_preferences` (email, display
/// name).
class User
{
public:
    User() noexcept = default;

    explicit User(std::string&& id) noexcept :
        m_id{std::move(id)}
    {
    }

    User(
        std::string&& id,
        std::string&& display_name,
        std::string&& email,
        std::string&& salt,
        std::string&& hash,
        std::uint32_t iterations,
        bool enabled,
        bool admin
    ) noexcept :
        m_id{std::move(id)},
        m_display_name{std::move(display_name)},
        m_email{std::move(email)},
        m_salt{std::move(salt)},
        m_hash{std::move(hash)},
        m_iterations{iterations},
        m_enabled{enabled},
        m_admin{admin}
    {
    }

    void set_id(std::string&& id) noexcept
    {
        m_id = std::move(id);
    }

    void set_display_name(std::string&& display_name) noexcept
    {
        m_display_name = std::move(display_name);
    }

    void set_email(std::string&& email) noexcept
    {
        m_email = std::move(email);
    }

    void set_salt(std::string&& salt) noexcept
    {
        m_salt = std::move(salt);
    }

    void set_hash(std::string&& hash) noexcept
    {
        m_hash = std::move(hash);
    }

    void set_iterations(std::uint32_t iterations) noexcept
    {
        m_iterations = iterations;
    }

    void set_enabled(bool enabled) noexcept
    {
        m_enabled = enabled;
    }

    void set_admin(bool admin) noexcept
    {
        m_admin = admin;
    }

    [[nodiscard]] std::string& get_id() noexcept
    {
        return m_id;
    }

    [[nodiscard]] const std::string& get_id() const noexcept
    {
        return m_id;
    }

    [[nodiscard]] std::string& get_display_name() noexcept
    {
        return m_display_name;
    }

    [[nodiscard]] const std::string& get_display_name() const noexcept
    {
        return m_display_name;
    }

    [[nodiscard]] std::string& get_email() noexcept
    {
        return m_email;
    }

    [[nodiscard]] const std::string& get_email() const noexcept
    {
        return m_email;
    }

    [[nodiscard]] std::string& get_salt() noexcept
    {
        return m_salt;
    }

    [[nodiscard]] const std::string& get_salt() const noexcept
    {
        return m_salt;
    }

    [[nodiscard]] std::string& get_hash() noexcept
    {
        return m_hash;
    }

    [[nodiscard]] const std::string& get_hash() const noexcept
    {
        return m_hash;
    }

    [[nodiscard]] std::uint32_t get_iterations() const noexcept
    {
        return m_iterations;
    }

    [[nodiscard]] bool is_enabled() const noexcept
    {
        return m_enabled;
    }

    [[nodiscard]] bool is_admin() const noexcept
    {
        return m_admin;
    }

    /// @brief The name to show: the display name, or the id when none is set.
    [[nodiscard]] const std::string& shown_name() const noexcept
    {
        return m_display_name.empty() ? m_id : m_display_name;
    }

private:
    std::string m_id{};
    std::string m_display_name{};
    std::string m_email{};
    std::string m_salt{};
    std::string m_hash{};
    std::uint32_t m_iterations{0};
    bool m_enabled{true};
    bool m_admin{false};
};

} // namespace nc::users
