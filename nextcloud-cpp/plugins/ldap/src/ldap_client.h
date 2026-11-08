#pragma once

#include "nextcloud/util/expected.h"

#include <cstdint>
#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace nc::ldap {

/// @brief One entry of a search: its DN and its attributes (every value of each).
class Entry
{
public:
    Entry() noexcept = default;

    Entry(std::string&& dn, std::map<std::string, std::vector<std::string>>&& attributes) noexcept :
        m_dn{std::move(dn)},
        m_attributes{std::move(attributes)}
    {
    }

    Entry& add_attribute(std::string&& name, std::vector<std::string>&& values)
    {
        m_attributes[std::move(name)] = std::move(values);
        return *this;
    }

    void set_dn(std::string&& dn) noexcept
    {
        m_dn = std::move(dn);
    }

    void set_attributes(std::map<std::string, std::vector<std::string>>&& attributes) noexcept
    {
        m_attributes = std::move(attributes);
    }

    [[nodiscard]] std::string& get_dn() noexcept
    {
        return m_dn;
    }

    [[nodiscard]] const std::string& get_dn() const noexcept
    {
        return m_dn;
    }

    [[nodiscard]] std::map<std::string, std::vector<std::string>>& get_attributes() noexcept
    {
        return m_attributes;
    }

    [[nodiscard]] const std::map<std::string, std::vector<std::string>>&
    get_attributes() const noexcept
    {
        return m_attributes;
    }

    /// @brief The first value of an attribute (names are case-insensitive in LDAP, kept lower case
    /// here).
    [[nodiscard]] std::string first(std::string_view name) const;

private:
    std::string m_dn{};
    std::map<std::string, std::vector<std::string>> m_attributes{};
};

/// @brief Where the directory is and how to find a person in it, the settings of Nextcloud's
/// `user_ldap`.
class LdapSettings
{
public:
    LdapSettings() noexcept = default;

    void set_host(std::string&& host) noexcept
    {
        m_host = std::move(host);
    }

    void set_port(std::string&& port) noexcept
    {
        m_port = std::move(port);
    }

    void set_base_dn(std::string&& base_dn) noexcept
    {
        m_base_dn = std::move(base_dn);
    }

    void set_bind_dn(std::string&& bind_dn) noexcept
    {
        m_bind_dn = std::move(bind_dn);
    }

    void set_bind_password(std::string&& password) noexcept
    {
        m_bind_password = std::move(password);
    }

    void set_user_attribute(std::string&& attribute) noexcept
    {
        m_user_attribute = std::move(attribute);
    }

    void set_object_class(std::string&& object_class) noexcept
    {
        m_object_class = std::move(object_class);
    }

    void set_display_attribute(std::string&& attribute) noexcept
    {
        m_display_attribute = std::move(attribute);
    }

    void set_mail_attribute(std::string&& attribute) noexcept
    {
        m_mail_attribute = std::move(attribute);
    }

    [[nodiscard]] std::string& get_host() noexcept
    {
        return m_host;
    }

    [[nodiscard]] const std::string& get_host() const noexcept
    {
        return m_host;
    }

    [[nodiscard]] std::string& get_port() noexcept
    {
        return m_port;
    }

    [[nodiscard]] const std::string& get_port() const noexcept
    {
        return m_port;
    }

    [[nodiscard]] std::string& get_base_dn() noexcept
    {
        return m_base_dn;
    }

    [[nodiscard]] const std::string& get_base_dn() const noexcept
    {
        return m_base_dn;
    }

    [[nodiscard]] std::string& get_bind_dn() noexcept
    {
        return m_bind_dn;
    }

    [[nodiscard]] const std::string& get_bind_dn() const noexcept
    {
        return m_bind_dn;
    }

    [[nodiscard]] std::string& get_bind_password() noexcept
    {
        return m_bind_password;
    }

    [[nodiscard]] const std::string& get_bind_password() const noexcept
    {
        return m_bind_password;
    }

    [[nodiscard]] std::string& get_user_attribute() noexcept
    {
        return m_user_attribute;
    }

    [[nodiscard]] const std::string& get_user_attribute() const noexcept
    {
        return m_user_attribute;
    }

    [[nodiscard]] std::string& get_object_class() noexcept
    {
        return m_object_class;
    }

    [[nodiscard]] const std::string& get_object_class() const noexcept
    {
        return m_object_class;
    }

    [[nodiscard]] std::string& get_display_attribute() noexcept
    {
        return m_display_attribute;
    }

    [[nodiscard]] const std::string& get_display_attribute() const noexcept
    {
        return m_display_attribute;
    }

    [[nodiscard]] std::string& get_mail_attribute() noexcept
    {
        return m_mail_attribute;
    }

    [[nodiscard]] const std::string& get_mail_attribute() const noexcept
    {
        return m_mail_attribute;
    }

private:
    std::string m_host{};
    std::string m_port{"389"};
    std::string m_base_dn{};
    std::string m_bind_dn{};
    std::string m_bind_password{};
    std::string m_user_attribute{"uid"};
    std::string m_object_class{"person"};
    std::string m_display_attribute{"displayName"};
    std::string m_mail_attribute{"mail"};
};

template<typename Value> using Result = util::expected<Value, std::string>;

/// @brief One LDAP v3 connection: simple bind and subtree search, enough to sign users in. Plain
/// TCP, no StartTLS and no LDAPS: use it towards a directory on a trusted network or through a
/// local TLS proxy.
class Connection
{
public:
    Connection() noexcept = default;
    ~Connection();
    Connection(const Connection&) = delete;
    Connection& operator=(const Connection&) = delete;
    Connection(Connection&&) = delete;
    Connection& operator=(Connection&&) = delete;

    Result<void> open(const std::string& host, const std::string& port);

    /// @brief Simple bind. An empty name with an empty password is an anonymous bind; a name with
    /// an empty password is refused before it is sent (servers treat that as an anonymous bind that
    /// "succeeds").
    Result<void> bind(std::string_view dn, std::string_view password);

    /// @brief Subtree search for entries of `object_class` whose `attribute` equals `value`. The
    /// filter is built as an encoded structure, never as text, so a name cannot add filter terms.
    Result<std::vector<Entry>> find(
        std::string_view base_dn,
        std::string_view object_class,
        std::string_view attribute,
        std::string_view value,
        const std::vector<std::string>& wanted
    );

private:
    Result<std::string> read_message();
    Result<void> send(std::string_view bytes);

    int m_fd{-1};
    std::int64_t m_next_id{1};
    std::string m_buffer{};
};

} // namespace nc::ldap
