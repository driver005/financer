#pragma once

#include "nextcloud/plugin.h"
#include "nextcloud/util/expected.h"

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

/// Nextcloud's trusted servers (`apps/federation`): servers an administrator names, which then
/// exchange a shared secret so that they can call each other's internal endpoints (the system
/// address book, for one). The records and the queue of handshake steps live here; the HTTP
/// between the two servers is the plugin's.
///
/// The handshake: each side holds a token it made for the other. The side that added the other
/// first asks it (`request-shared-secret`, with its own address and token); the one asked queues a
/// `get`; of the two tokens the lower one wins: that server fetches the secret
/// (`shared-secret`, with the token the other made), the other makes the secret, remembers it and
/// hands it over. Both then hold the same secret.
namespace nc::federation {

class TrustedServers
{
public:
    enum Status : int
    {
        OK = 1,
        PENDING = 2,
        FAILURE = 3,
        ACCESS_REVOKED = 4
    };

    struct Server
    {
        std::int64_t id{0};
        std::string server{}; // normalized: host[:port][/path], no scheme
        std::string url{};    // as given, with its scheme and without a trailing slash
        int status{PENDING};
        std::string token{};  // the one this server made for the other
        std::string secret{}; // empty until exchanged
        std::int64_t created{0};
    };

    /// A step of the handshake waiting to be tried.
    struct Step
    {
        std::int64_t id{0};
        std::string kind{}; // "request" or "get"
        std::string server{};
        std::string token{};
        std::string own{}; // this server's address as the other one is told it
        std::int64_t created{0};
        int attempt{0};
    };

    explicit TrustedServers(nc::Host* host) noexcept :
        m_host{host}
    {
    }

    /// @brief Creates the tables.
    void migrate() const;

    /// @brief `https://Cloud.Example/` and `cloud.example` are the same server: no scheme, no
    /// trailing slash, host in lower case. Empty for something that is not an address.
    [[nodiscard]] static std::string normalize(std::string_view url);

    [[nodiscard]] std::vector<Server> list() const;
    [[nodiscard]] std::optional<Server> find(std::string_view url) const;

    /// @brief Adds a server (status pending, a token for it, a `request` step queued). Fails when
    /// the address is not usable or the server is known already.
    [[nodiscard]] util::expected<Server, std::string>
    add(std::string_view url, std::string_view own, std::int64_t now) const;

    /// @brief Removes a server and what is queued for it.
    [[nodiscard]] bool remove(std::int64_t id) const;

    void set_status(std::string_view server, int status) const;

    /// @brief Keeps the shared secret and calls the server good.
    void set_secret(std::string_view server, const std::string& secret) const;

    /// @brief True when `token` is the one this server made for `url` (compared in constant time).
    [[nodiscard]] bool token_matches(std::string_view url, std::string_view token) const;

    /// @brief The secret with a server, empty when there is none.
    [[nodiscard]] std::string secret_of(std::string_view url) const;

    /// @brief True when `secret` is the one shared with `url`.
    [[nodiscard]] bool secret_matches(std::string_view url, std::string_view secret) const;

    // The queue.
    void queue(
        const std::string& kind,
        const std::string& server,
        const std::string& token,
        const std::string& own,
        std::int64_t created
    ) const;
    [[nodiscard]] std::vector<Step> due(std::int64_t now) const;
    void finish(std::int64_t step) const;
    void retry(const Step& step, std::int64_t now) const;

private:
    nc::Host* m_host;
};

} // namespace nc::federation
