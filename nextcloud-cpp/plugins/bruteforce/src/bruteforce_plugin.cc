/**
 * @file bruteforce_plugin.cc
 * @brief Brute-force protection (Nextcloud's `Throttler`): an address that signs in wrongly too
 * often has to wait, and the wait grows with every further failure.
 *
 * The kernel publishes `auth.failed` (login name, reason, address) and asks `auth.throttle` before
 * it looks at credentials. From `max_attempts` failures of one address in `window_seconds` on, the
 * answer is 429 with `Retry-After`, for 0.25 s after the last failure at first, twice as long with
 * every failure after that, at most until the window has passed. Nobody is held while waiting (the
 * PHP original sleeps in the request): the client is told when to come back. The wait is measured
 * from the last failure and refused requests are not counted, so a client that waits is let in.
 *
 * A good password clears what the same address got wrong for the same account
 * (`auth.throttle_reset`), nothing else, so signing in to one's own account does not wipe guesses
 * at another. Addresses in `whitelist` (exact addresses or CIDR ranges) are never held. The counts
 * are in memory: a restart forgets them.
 *
 * Config: `max_attempts` (10), `window_seconds` (1800), `whitelist` (comma separated).
 */
#include "nextcloud/plugin.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <arpa/inet.h>
#include <chrono>
#include <cmath>
#include <cstring>
#include <deque>
#include <mutex>
#include <netinet/in.h>
#include <unordered_map>

namespace {

using nc::http::Response;
using Clock = std::chrono::system_clock;

constexpr std::size_t MAX_ADDRESSES = 100'000;

struct Range
{
    in6_addr base{};
    int prefix{128};
};

/// An address (IPv4 shows as IPv4-mapped IPv6, so one comparison serves both).
bool parse_address(const std::string& text, in6_addr& out)
{
    in_addr v4{};
    if (::inet_pton(AF_INET, text.c_str(), &v4) == 1) {
        std::memset(&out, 0, sizeof(out));
        out.s6_addr[10] = 0xFF;
        out.s6_addr[11] = 0xFF;
        std::memcpy(&out.s6_addr[12], &v4, 4);
        return true;
    }
    return ::inet_pton(AF_INET6, text.c_str(), &out) == 1;
}

class BruteforcePlugin final : public nc::Plugin
{
public:
    [[nodiscard]] std::string_view get_name() const noexcept override
    {
        return "bruteforce";
    }

    [[nodiscard]] std::string_view get_version() const noexcept override
    {
        return "1.0.0";
    }

    [[nodiscard]] std::string_view get_description() const noexcept override
    {
        return "Makes an address wait after too many wrong passwords";
    }

    void on_load(nc::Host& host) override
    {
        m_max = std::max(1, std::atoi(host.config("max_attempts", "10").c_str()));
        m_window = std::chrono::seconds{
            std::max(1, std::atoi(host.config("window_seconds", "1800").c_str()))
        };
        for (const std::string& entry: nc::util::split(host.config("whitelist", ""), ',')) {
            const std::string text{nc::util::trim(entry)};
            if (text.empty()) {
                continue;
            }
            const std::size_t slash = text.find('/');
            Range range;
            if (!parse_address(text.substr(0, slash), range.base)) {
                continue;
            }
            const bool v4 = text.find('.') != std::string::npos;
            // A single address is all 128 bits (an IPv4 one is mapped into IPv6); a range names
            // how many of its own bits count.
            range.prefix = 128;
            if (slash != std::string::npos) {
                const int bits = std::atoi(text.c_str() + slash + 1);
                range.prefix = std::clamp(bits, 0, v4 ? 32 : 128) + (v4 ? 96 : 0);
            }
            m_whitelist.push_back(range);
        }

        host.add_service(
            "auth.throttle",
            [this](std::string_view address)
            {
                return check(std::string{address});
            }
        );
        host.add_service(
            "auth.throttle_reset",
            [this](std::string_view args)
            {
                const std::size_t newline = args.find('\n');
                reset(
                    std::string{args.substr(0, newline)},
                    newline == std::string_view::npos ? std::string{}
                                                      : std::string{args.substr(newline + 1)}
                );
                return Response::text(200, "");
            }
        );
        host.subscribe(
            "auth.failed",
            [this](std::string_view, std::string_view payload)
            {
                const auto form = nc::util::parse_form(payload);
                note(nc::util::form_value(form, "ip"), nc::util::form_value(form, "user"));
            }
        );
    }

private:
    struct Failure
    {
        Clock::time_point when;
        std::string user;
    };

    [[nodiscard]] bool whitelisted(const std::string& address) const
    {
        in6_addr parsed{};
        if (!parse_address(address, parsed)) {
            return false;
        }
        return std::any_of(
            m_whitelist.begin(),
            m_whitelist.end(),
            [&](const Range& range)
            {
                const int whole = range.prefix / 8;
                if (std::memcmp(&parsed, &range.base, static_cast<std::size_t>(whole)) != 0) {
                    return false;
                }
                const int rest = range.prefix % 8;
                if (rest == 0) {
                    return true;
                }
                const auto mask = static_cast<unsigned char>(0xFFU << (8 - rest));
                return (parsed.s6_addr[whole] & mask) == (range.base.s6_addr[whole] & mask);
            }
        );
    }

    static void
    forget_old(std::deque<Failure>& failures, Clock::time_point now, Clock::duration window)
    {
        while (!failures.empty() && now - failures.front().when > window) {
            failures.pop_front();
        }
    }

    void note(const std::string& address, const std::string& user)
    {
        if (address.empty() || whitelisted(address)) {
            return;
        }
        const Clock::time_point now = Clock::now();
        const std::lock_guard lock{m_mutex};
        if (m_failures.size() >= MAX_ADDRESSES && m_failures.find(address) == m_failures.end()) {
            // Forget what has expired; if the table is still full, start over rather than grow.
            for (auto it = m_failures.begin(); it != m_failures.end();) {
                forget_old(it->second, now, m_window);
                it = it->second.empty() ? m_failures.erase(it) : std::next(it);
            }
            if (m_failures.size() >= MAX_ADDRESSES) {
                m_failures.clear();
            }
        }
        std::deque<Failure>& failures = m_failures[address];
        forget_old(failures, now, m_window);
        failures.push_back({now, user});
    }

    [[nodiscard]] Response check(const std::string& address)
    {
        const Clock::time_point now = Clock::now();
        const std::lock_guard lock{m_mutex};
        const auto found = m_failures.find(address);
        if (found == m_failures.end()) {
            return Response::text(200, "");
        }
        forget_old(found->second, now, m_window);
        const auto count = static_cast<int>(found->second.size());
        if (count < m_max) {
            if (count == 0) {
                m_failures.erase(found);
            }
            return Response::text(200, "");
        }
        // 0.25 s after the tenth failure (by default), doubling with each, at most the window.
        const double wait_seconds = std::min(
            0.25 * std::pow(2.0, std::min(count - m_max, 40)),
            std::chrono::duration<double>(m_window).count()
        );
        const auto until =
            found->second.back().when +
            std::chrono::duration_cast<Clock::duration>(std::chrono::duration<double>(wait_seconds)
            );
        if (now >= until) {
            return Response::text(200, "");
        }
        const auto remaining =
            static_cast<long>(std::ceil(std::chrono::duration<double>(until - now).count()));
        Response answer = Response::text(429, "Too many failed sign-ins; try again later");
        answer.add_header("Retry-After", std::to_string(std::max(1L, remaining)));
        return answer;
    }

    void reset(const std::string& address, const std::string& user)
    {
        if (address.empty()) {
            return;
        }
        const std::lock_guard lock{m_mutex};
        const auto found = m_failures.find(address);
        if (found == m_failures.end()) {
            return;
        }
        std::erase_if(
            found->second,
            [&](const Failure& failure)
            {
                return failure.user == user;
            }
        );
        if (found->second.empty()) {
            m_failures.erase(found);
        }
    }

    int m_max{10};
    Clock::duration m_window{std::chrono::seconds{1'800}};
    std::vector<Range> m_whitelist{};
    std::mutex m_mutex{};
    std::unordered_map<std::string, std::deque<Failure>> m_failures{};
};

} // namespace

NC_PLUGIN(BruteforcePlugin)
