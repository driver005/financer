#pragma once

#include "mime.h"

#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace nc::mail {

/// @brief Who the mail goes to on the wire, as opposed to what its headers say (Bcc is only here).
class Envelope
{
public:
    Envelope() noexcept = default;

    Envelope(std::string&& from, std::vector<std::string>&& recipients) noexcept :
        m_from{std::move(from)},
        m_recipients{std::move(recipients)}
    {
    }

    Envelope& add_recipient(std::string&& address)
    {
        m_recipients.push_back(std::move(address));
        return *this;
    }

    void set_from(std::string&& from) noexcept
    {
        m_from = std::move(from);
    }

    void set_recipients(std::vector<std::string>&& recipients) noexcept
    {
        m_recipients = std::move(recipients);
    }

    [[nodiscard]] std::string& get_from() noexcept
    {
        return m_from;
    }

    [[nodiscard]] const std::string& get_from() const noexcept
    {
        return m_from;
    }

    [[nodiscard]] std::vector<std::string>& get_recipients() noexcept
    {
        return m_recipients;
    }

    [[nodiscard]] const std::vector<std::string>& get_recipients() const noexcept
    {
        return m_recipients;
    }

private:
    std::string m_from{};
    std::vector<std::string> m_recipients{};
};

/// @brief How a built message leaves the machine; Nextcloud's `mail_smtpmode`.
class Transport
{
public:
    Transport() noexcept = default;
    virtual ~Transport() = default;
    Transport(const Transport&) = delete;
    Transport& operator=(const Transport&) = delete;
    Transport(Transport&&) = delete;
    Transport& operator=(Transport&&) = delete;

    [[nodiscard]] virtual Result<void>
    send(const Envelope& envelope, std::string_view message) const = 0;
    [[nodiscard]] virtual std::string_view name() const noexcept = 0;
};

/// @brief Drops the mail. For installations that must not send (`mode = null`).
class NullTransport final : public Transport
{
public:
    [[nodiscard]] Result<void> send(const Envelope&, std::string_view) const override
    {
        return {};
    }

    [[nodiscard]] std::string_view name() const noexcept override
    {
        return "null";
    }
};

/// @brief Writes every mail to a directory as `<id>.eml` plus `<id>.envelope` (sender and
/// recipients). For development and tests, and for a separate process that picks the files up.
class SpoolTransport final : public Transport
{
public:
    explicit SpoolTransport(std::string&& directory) noexcept :
        m_directory{std::move(directory)}
    {
    }

    [[nodiscard]] Result<void>
    send(const Envelope& envelope, std::string_view message) const override;

    [[nodiscard]] std::string_view name() const noexcept override
    {
        return "spool";
    }

private:
    std::string m_directory{};
};

/// @brief Hands the mail to a local `sendmail` compatible program (`sendmail -i -f FROM --
/// RCPT...`), started without a shell.
class SendmailTransport final : public Transport
{
public:
    explicit SendmailTransport(std::string&& program) noexcept :
        m_program{std::move(program)}
    {
    }

    [[nodiscard]] Result<void>
    send(const Envelope& envelope, std::string_view message) const override;

    [[nodiscard]] std::string_view name() const noexcept override
    {
        return "sendmail";
    }

private:
    std::string m_program{};
};

/// @brief Plain SMTP to a relay (RFC 5321): EHLO, MAIL, RCPT, DATA. No TLS and no authentication,
/// so use it towards a relay on localhost or a trusted network, or use sendmail.
class SmtpTransport final : public Transport
{
public:
    SmtpTransport(std::string&& host, std::string&& port, std::string&& helo_name) noexcept :
        m_host{std::move(host)},
        m_port{std::move(port)},
        m_helo_name{std::move(helo_name)}
    {
    }

    [[nodiscard]] Result<void>
    send(const Envelope& envelope, std::string_view message) const override;

    [[nodiscard]] std::string_view name() const noexcept override
    {
        return "smtp";
    }

private:
    std::string m_host{};
    std::string m_port{"25"};
    std::string m_helo_name{"localhost"};
};

} // namespace nc::mail
