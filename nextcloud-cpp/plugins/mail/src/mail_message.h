#pragma once

#include <string>
#include <utility>
#include <vector>

namespace nc::mail {

/// @brief One outgoing mail, the counterpart of Nextcloud's `OCP\Mail\IMessage`.
class MailMessage
{
public:
    MailMessage() noexcept = default;

    MailMessage(std::string&& from, std::string&& subject) noexcept :
        m_from{std::move(from)},
        m_subject{std::move(subject)}
    {
    }

    MailMessage(
        std::string&& from,
        std::string&& from_name,
        std::string&& reply_to,
        std::vector<std::string>&& to,
        std::vector<std::string>&& cc,
        std::vector<std::string>&& bcc,
        std::string&& subject,
        std::string&& plain_body,
        std::string&& html_body
    ) noexcept :
        m_from{std::move(from)},
        m_from_name{std::move(from_name)},
        m_reply_to{std::move(reply_to)},
        m_to{std::move(to)},
        m_cc{std::move(cc)},
        m_bcc{std::move(bcc)},
        m_subject{std::move(subject)},
        m_plain_body{std::move(plain_body)},
        m_html_body{std::move(html_body)}
    {
    }

    MailMessage& add_to(std::string&& address)
    {
        m_to.push_back(std::move(address));
        return *this;
    }

    MailMessage& add_cc(std::string&& address)
    {
        m_cc.push_back(std::move(address));
        return *this;
    }

    MailMessage& add_bcc(std::string&& address)
    {
        m_bcc.push_back(std::move(address));
        return *this;
    }

    void set_from(std::string&& from) noexcept
    {
        m_from = std::move(from);
    }

    void set_from_name(std::string&& from_name) noexcept
    {
        m_from_name = std::move(from_name);
    }

    void set_reply_to(std::string&& reply_to) noexcept
    {
        m_reply_to = std::move(reply_to);
    }

    void set_to(std::vector<std::string>&& to) noexcept
    {
        m_to = std::move(to);
    }

    void set_cc(std::vector<std::string>&& cc) noexcept
    {
        m_cc = std::move(cc);
    }

    void set_bcc(std::vector<std::string>&& bcc) noexcept
    {
        m_bcc = std::move(bcc);
    }

    void set_subject(std::string&& subject) noexcept
    {
        m_subject = std::move(subject);
    }

    void set_plain_body(std::string&& body) noexcept
    {
        m_plain_body = std::move(body);
    }

    void set_html_body(std::string&& body) noexcept
    {
        m_html_body = std::move(body);
    }

    [[nodiscard]] std::string& get_from() noexcept
    {
        return m_from;
    }

    [[nodiscard]] const std::string& get_from() const noexcept
    {
        return m_from;
    }

    [[nodiscard]] std::string& get_from_name() noexcept
    {
        return m_from_name;
    }

    [[nodiscard]] const std::string& get_from_name() const noexcept
    {
        return m_from_name;
    }

    [[nodiscard]] std::string& get_reply_to() noexcept
    {
        return m_reply_to;
    }

    [[nodiscard]] const std::string& get_reply_to() const noexcept
    {
        return m_reply_to;
    }

    [[nodiscard]] std::vector<std::string>& get_to() noexcept
    {
        return m_to;
    }

    [[nodiscard]] const std::vector<std::string>& get_to() const noexcept
    {
        return m_to;
    }

    [[nodiscard]] std::vector<std::string>& get_cc() noexcept
    {
        return m_cc;
    }

    [[nodiscard]] const std::vector<std::string>& get_cc() const noexcept
    {
        return m_cc;
    }

    [[nodiscard]] std::vector<std::string>& get_bcc() noexcept
    {
        return m_bcc;
    }

    [[nodiscard]] const std::vector<std::string>& get_bcc() const noexcept
    {
        return m_bcc;
    }

    [[nodiscard]] std::string& get_subject() noexcept
    {
        return m_subject;
    }

    [[nodiscard]] const std::string& get_subject() const noexcept
    {
        return m_subject;
    }

    [[nodiscard]] std::string& get_plain_body() noexcept
    {
        return m_plain_body;
    }

    [[nodiscard]] const std::string& get_plain_body() const noexcept
    {
        return m_plain_body;
    }

    [[nodiscard]] std::string& get_html_body() noexcept
    {
        return m_html_body;
    }

    [[nodiscard]] const std::string& get_html_body() const noexcept
    {
        return m_html_body;
    }

    /// @brief Everyone the mail goes to on the wire: to, cc and bcc.
    [[nodiscard]] std::vector<std::string> recipients() const
    {
        std::vector<std::string> all = m_to;
        all.insert(all.end(), m_cc.begin(), m_cc.end());
        all.insert(all.end(), m_bcc.begin(), m_bcc.end());
        return all;
    }

private:
    std::string m_from{};
    std::string m_from_name{};
    std::string m_reply_to{};
    std::vector<std::string> m_to{};
    std::vector<std::string> m_cc{};
    std::vector<std::string> m_bcc{};
    std::string m_subject{};
    std::string m_plain_body{};
    std::string m_html_body{};
};

} // namespace nc::mail
