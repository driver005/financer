#include "ldap_client.h"

#include "ber.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <cctype>
#include <netdb.h>
#include <sys/socket.h>
#include <unistd.h>

namespace nc::ldap {

namespace {

    util::unexpected<std::string> failure(std::string message)
    {
        return util::unexpected<std::string>{std::move(message)};
    }

    constexpr std::size_t MAX_MESSAGE = 1U << 20U;

} // namespace

std::string Entry::first(std::string_view name) const
{
    const auto found = m_attributes.find(util::to_lower(name));
    return found == m_attributes.end() || found->second.empty() ? std::string{}
                                                                : found->second.front();
}

Connection::~Connection()
{
    if (m_fd >= 0) {
        (void)send(ber::element(
            ber::SEQUENCE,
            ber::integer(m_next_id++) + ber::element(ber::UNBIND_REQUEST, "")
        ));
        ::close(m_fd);
    }
}

Result<void> Connection::open(const std::string& host, const std::string& port)
{
    addrinfo hints{};
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* found = nullptr;
    if (const int code = ::getaddrinfo(host.c_str(), port.c_str(), &hints, &found); code != 0) {
        return failure("cannot resolve " + host + ": " + ::gai_strerror(code));
    }
    for (const addrinfo* candidate = found; candidate != nullptr; candidate = candidate->ai_next) {
        const int fd =
            ::socket(candidate->ai_family, candidate->ai_socktype, candidate->ai_protocol);
        if (fd < 0) {
            continue;
        }
        if (::connect(fd, candidate->ai_addr, candidate->ai_addrlen) == 0) {
            m_fd = fd;
            break;
        }
        ::close(fd);
    }
    ::freeaddrinfo(found);
    if (m_fd < 0) {
        return failure("cannot connect to " + host + ":" + port);
    }
    timeval timeout{};
    timeout.tv_sec = 10;
    ::setsockopt(m_fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    ::setsockopt(m_fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    return {};
}

Result<void> Connection::send(std::string_view bytes)
{
    while (!bytes.empty()) {
        const ssize_t written = ::send(m_fd, bytes.data(), bytes.size(), MSG_NOSIGNAL);
        if (written <= 0) {
            return failure("the directory closed the connection");
        }
        bytes.remove_prefix(static_cast<std::size_t>(written));
    }
    return {};
}

Result<std::string> Connection::read_message()
{
    while (true) {
        const auto length = ber::complete_length(m_buffer);
        if (!length || *length > MAX_MESSAGE) {
            return failure("the directory sent something that is not LDAP");
        }
        if (*length > 0) {
            std::string message = m_buffer.substr(0, *length);
            m_buffer.erase(0, *length);
            return message;
        }
        char chunk[4'096];
        const ssize_t got = ::recv(m_fd, chunk, sizeof(chunk), 0);
        if (got <= 0) {
            return failure("no answer from the directory");
        }
        m_buffer.append(chunk, static_cast<std::size_t>(got));
        if (m_buffer.size() > MAX_MESSAGE + 16) {
            return failure("the directory sent too much");
        }
    }
}

namespace {

    struct Reply
    {
        std::int64_t id{0};
        ber::Element op{};
        std::string_view payload{};
    };

    /// Splits an LDAPMessage into its id and its operation.
    std::optional<Reply> parse_reply(std::string_view message)
    {
        const auto outer = ber::read(message);
        if (!outer || outer->tag != ber::SEQUENCE) {
            return std::nullopt;
        }
        std::string_view inner = outer->content;
        const auto id = ber::read(inner);
        const auto op = ber::read(inner);
        if (!id || !op || id->tag != ber::INTEGER) {
            return std::nullopt;
        }
        const auto number = ber::as_integer(*id);
        if (!number) {
            return std::nullopt;
        }
        return Reply{*number, *op, op->content};
    }

    /// resultCode, diagnosticMessage of an LDAPResult.
    std::pair<std::int64_t, std::string> parse_result(std::string_view payload)
    {
        const auto code = ber::read(payload);
        const auto matched = ber::read(payload);
        const auto diagnostic = ber::read(payload);
        if (!code || !matched || !diagnostic) {
            return {-1, "malformed result"};
        }
        return {ber::as_integer(*code).value_or(-1), std::string{diagnostic->content}};
    }

} // namespace

Result<void> Connection::bind(std::string_view dn, std::string_view password)
{
    if (!dn.empty() && password.empty()) {
        return failure("an empty password is not a password");
    }
    const std::int64_t id = m_next_id++;
    const std::string request = ber::element(
        ber::BIND_REQUEST,
        ber::integer(3) + ber::octets(dn) + ber::element(ber::SIMPLE_AUTH, password)
    );
    if (auto sent = send(ber::element(ber::SEQUENCE, ber::integer(id) + request)); !sent) {
        return sent;
    }
    auto message = read_message();
    if (!message) {
        return util::unexpected<std::string>{message.error()};
    }
    const auto reply = parse_reply(*message);
    if (!reply || reply->id != id || reply->op.tag != ber::BIND_RESPONSE) {
        return failure("unexpected answer to a bind");
    }
    const auto [code, text] = parse_result(reply->payload);
    if (code != 0) {
        return failure(
            "bind refused (" + std::to_string(code) + (text.empty() ? "" : ": " + text) + ")"
        );
    }
    return {};
}

Result<std::vector<Entry>> Connection::find(
    std::string_view base_dn,
    std::string_view object_class,
    std::string_view attribute,
    std::string_view value,
    const std::vector<std::string>& wanted
)
{
    const std::int64_t id = m_next_id++;
    const auto equals = [](std::string_view name, std::string_view text)
    {
        return ber::element(ber::FILTER_EQUALITY, ber::octets(name) + ber::octets(text));
    };
    const std::string filter = ber::element(
        ber::FILTER_AND,
        equals("objectClass", object_class) + equals(attribute, value)
    );
    std::string attributes;
    for (const std::string& name: wanted) {
        attributes += ber::octets(name);
    }
    const std::string request = ber::element(
        ber::SEARCH_REQUEST,
        ber::octets(base_dn) + ber::integer(2, ber::ENUMERATED) + ber::integer(0, ber::ENUMERATED) +
            ber::integer(2) + ber::integer(10) + ber::element(0x01, std::string(1, '\0')) + filter +
            ber::element(ber::SEQUENCE, attributes)
    );
    if (auto sent = send(ber::element(ber::SEQUENCE, ber::integer(id) + request)); !sent) {
        return util::unexpected<std::string>{sent.error()};
    }
    std::vector<Entry> entries;
    while (true) {
        auto message = read_message();
        if (!message) {
            return util::unexpected<std::string>{message.error()};
        }
        const auto reply = parse_reply(*message);
        if (!reply || reply->id != id) {
            return failure("unexpected answer to a search");
        }
        if (reply->op.tag == ber::SEARCH_DONE) {
            const auto [code, text] = parse_result(reply->payload);
            // 4 is "size limit exceeded": we asked for at most 2 entries, which is all we need to
            // see.
            if (code != 0 && code != 4) {
                return failure(
                    "search failed (" + std::to_string(code) + (text.empty() ? "" : ": " + text) +
                    ")"
                );
            }
            return entries;
        }
        if (reply->op.tag != ber::SEARCH_ENTRY) {
            continue; // references and the like
        }
        std::string_view payload = reply->payload;
        const auto name = ber::read(payload);
        const auto list = ber::read(payload);
        if (!name || !list) {
            return failure("malformed search entry");
        }
        Entry entry;
        entry.set_dn(std::string{name->content});
        std::string_view pairs = list->content;
        while (!pairs.empty()) {
            const auto pair = ber::read(pairs);
            if (!pair) {
                return failure("malformed attribute");
            }
            std::string_view parts = pair->content;
            const auto type = ber::read(parts);
            const auto set = ber::read(parts);
            if (!type || !set) {
                return failure("malformed attribute");
            }
            std::vector<std::string> values;
            std::string_view items = set->content;
            while (!items.empty()) {
                const auto item = ber::read(items);
                if (!item) {
                    return failure("malformed attribute value");
                }
                values.emplace_back(item->content);
            }
            entry.add_attribute(util::to_lower(type->content), std::move(values));
        }
        entries.push_back(std::move(entry));
    }
}

} // namespace nc::ldap
