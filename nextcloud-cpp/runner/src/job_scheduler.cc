#include "nextcloud/runner/job_scheduler.h"

#include <algorithm>

namespace nc {

void JobScheduler::add(
    std::string_view name,
    std::string_view owner,
    std::chrono::seconds interval,
    Handler&& handler
)
{
    auto job = std::make_shared<Job>();
    job->info.name = std::string{name};
    job->info.owner = std::string{owner};
    job->info.interval = std::max(interval, std::chrono::seconds{1});
    job->handler = std::move(handler);
    job->next = Clock::now() + job->info.interval;
    const std::lock_guard lock{m_mutex};
    m_jobs.push_back(std::move(job));
}

void JobScheduler::remove_owner(std::string_view owner)
{
    const std::lock_guard lock{m_mutex};
    std::erase_if(
        m_jobs,
        [owner](const std::shared_ptr<Job>& job)
        {
            return job->info.owner == owner;
        }
    );
}

std::size_t JobScheduler::run_due(Clock::time_point now, bool force)
{
    std::vector<std::shared_ptr<Job>> due;
    {
        const std::lock_guard lock{m_mutex};
        for (const std::shared_ptr<Job>& job: m_jobs) {
            if (!job->running && (force || now >= job->next)) {
                job->running = true;
                due.push_back(job);
            }
        }
    }
    for (const std::shared_ptr<Job>& job: due) {
        bool good = false;
        try {
            good = job->handler();
        } catch (const std::exception& error) {
            if (m_logger != nullptr) {
                m_logger->log(
                    LogLevel::ERROR,
                    job->info.owner,
                    "job " + job->info.name + " threw: " + error.what()
                );
            }
        } catch (...) {
            if (m_logger != nullptr) {
                m_logger->log(LogLevel::ERROR, job->info.owner, "job " + job->info.name + " threw");
            }
        }
        const std::lock_guard lock{m_mutex};
        ++job->info.runs;
        job->info.failures += good ? 0 : 1;
        job->next = Clock::now() + job->info.interval;
        job->running = false;
    }
    return due.size();
}

std::vector<JobScheduler::Info> JobScheduler::list() const
{
    const std::lock_guard lock{m_mutex};
    std::vector<Info> infos;
    for (const std::shared_ptr<Job>& job: m_jobs) {
        infos.push_back(job->info);
    }
    return infos;
}

} // namespace nc
