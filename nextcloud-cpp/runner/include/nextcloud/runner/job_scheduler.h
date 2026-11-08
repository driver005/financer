#pragma once

#include "nextcloud/runner/log.h"

#include <chrono>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <vector>

namespace nc {

/// @brief Background jobs, the counterpart of Nextcloud's `lib/private/BackgroundJob` (`TimedJob`,
/// run by cron.php). A job has a name, an interval and an owner (the plugin); the scheduler itself
/// has no thread: the runner calls `run_due` once a second while it serves, and `occ
/// background:run` calls it with `force` to run everything once.
class JobScheduler
{
public:
    using Clock = std::chrono::steady_clock;
    /// Returns true when the job went well.
    using Handler = std::function<bool()>;

    explicit JobScheduler(const Logger* logger = nullptr) noexcept :
        m_logger{logger}
    {
    }

    void
    add(std::string_view name,
        std::string_view owner,
        std::chrono::seconds interval,
        Handler&& handler);
    void remove_owner(std::string_view owner);

    /// @brief Runs the jobs whose time has come (all of them with `force`); returns how many ran. A
    /// job is not started again while it is still running, whichever thread asked.
    std::size_t run_due(Clock::time_point now = Clock::now(), bool force = false);

    struct Info
    {
        std::string name{};
        std::string owner{};
        std::chrono::seconds interval{0};
        std::size_t runs{0};
        std::size_t failures{0};
    };

    [[nodiscard]] std::vector<Info> list() const;

private:
    struct Job
    {
        Info info{};
        Handler handler{};
        Clock::time_point next{};
        bool running{false};
    };

    const Logger* m_logger{nullptr};
    mutable std::mutex m_mutex{};
    std::vector<std::shared_ptr<Job>> m_jobs{};
};

} // namespace nc
