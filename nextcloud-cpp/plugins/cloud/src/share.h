#pragma once

#include <cstdint>
#include <string>
#include <utility>

namespace nc::cloud {

/// Share types, as in Nextcloud's `OCP\Share\IShare`.
inline constexpr int SHARE_TYPE_USER = 0;
inline constexpr int SHARE_TYPE_GROUP = 1;
inline constexpr int SHARE_TYPE_LINK = 3;

/// @brief One share: a path of the owner offered to a user or through a public link.
class Share
{
public:
    Share() noexcept = default;

    Share(std::string&& owner, std::string&& path) noexcept :
        m_owner{std::move(owner)},
        m_path{std::move(path)}
    {
    }

    Share(
        std::uint64_t id,
        std::string&& token,
        int type,
        std::string&& owner,
        std::string&& share_with,
        std::string&& path,
        int permissions,
        std::int64_t expires,
        std::int64_t created
    ) noexcept :
        m_id{id},
        m_token{std::move(token)},
        m_type{type},
        m_owner{std::move(owner)},
        m_share_with{std::move(share_with)},
        m_path{std::move(path)},
        m_permissions{permissions},
        m_expires{expires},
        m_created{created}
    {
    }

    void set_id(std::uint64_t id) noexcept
    {
        m_id = id;
    }

    void set_token(std::string&& token) noexcept
    {
        m_token = std::move(token);
    }

    void set_type(int type) noexcept
    {
        m_type = type;
    }

    void set_owner(std::string&& owner) noexcept
    {
        m_owner = std::move(owner);
    }

    void set_share_with(std::string&& share_with) noexcept
    {
        m_share_with = std::move(share_with);
    }

    void set_path(std::string&& path) noexcept
    {
        m_path = std::move(path);
    }

    void set_permissions(int permissions) noexcept
    {
        m_permissions = permissions;
    }

    void set_expires(std::int64_t expires) noexcept
    {
        m_expires = expires;
    }

    void set_created(std::int64_t created) noexcept
    {
        m_created = created;
    }

    void set_password(std::string&& password) noexcept
    {
        m_password = std::move(password);
    }

    [[nodiscard]] std::uint64_t get_id() const noexcept
    {
        return m_id;
    }

    [[nodiscard]] std::string& get_token() noexcept
    {
        return m_token;
    }

    [[nodiscard]] const std::string& get_token() const noexcept
    {
        return m_token;
    }

    [[nodiscard]] int get_type() const noexcept
    {
        return m_type;
    }

    [[nodiscard]] std::string& get_owner() noexcept
    {
        return m_owner;
    }

    [[nodiscard]] const std::string& get_owner() const noexcept
    {
        return m_owner;
    }

    [[nodiscard]] std::string& get_share_with() noexcept
    {
        return m_share_with;
    }

    [[nodiscard]] const std::string& get_share_with() const noexcept
    {
        return m_share_with;
    }

    [[nodiscard]] std::string& get_path() noexcept
    {
        return m_path;
    }

    [[nodiscard]] const std::string& get_path() const noexcept
    {
        return m_path;
    }

    [[nodiscard]] int get_permissions() const noexcept
    {
        return m_permissions;
    }

    [[nodiscard]] std::int64_t get_expires() const noexcept
    {
        return m_expires;
    }

    [[nodiscard]] std::int64_t get_created() const noexcept
    {
        return m_created;
    }

    /// `iterations$salt$hash` of the link's password, empty for a link without one.
    [[nodiscard]] std::string& get_password() noexcept
    {
        return m_password;
    }

    [[nodiscard]] const std::string& get_password() const noexcept
    {
        return m_password;
    }

    /// @brief Whether the share has run out at `now` (unix seconds). 0 means it never does.
    [[nodiscard]] bool expired(std::int64_t now) const noexcept
    {
        return m_expires != 0 && now >= m_expires;
    }

private:
    std::uint64_t m_id{0};
    std::string m_token{};
    int m_type{SHARE_TYPE_LINK};
    std::string m_owner{};
    std::string m_share_with{};
    std::string m_path{};
    int m_permissions{1};
    std::int64_t m_expires{0};
    std::int64_t m_created{0};
    std::string m_password{};
};

} // namespace nc::cloud
