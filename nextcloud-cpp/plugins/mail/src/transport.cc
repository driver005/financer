#include "transport.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <cerrno>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <netdb.h>
#include <spawn.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

extern char** environ;

namespace nc::mail {

namespace {

    util::unexpected<std::string> failure(std::string message)
    {
        return util::unexpected<std::string>{std::move(message)};
    }

    /// The address goes on a command line and into SMTP commands: refuse anything that could break
    /// out.
    bool safe_address(std::string_view address) noexcept
    {
        return util::is_valid_email(address);
    }

    bool write_all(int fd, std::string_view data) noexcept
    {
        while (!data.empty()) {
            const ssize_t written = ::write(fd, data.data(), data.size());
            if (written < 0) {
                if (errno == EINTR) {
                    continue;
                }
                return false;
            }
            data.remove_prefix(static_cast<std::size_t>(written));
        }
        return true;
    }

    /// Reads one SMTP reply (possibly several `250-` lines); returns its code, or -1 on a broken
    /// connection.
    int read_reply(int fd, std::string& text)
    {
        text.clear();
        std::string pending;
        while (true) {
            std::size_t newline;
            while ((newline = pending.find('\n')) == std::string::npos) {
                char chunk[1'024];
                const ssize_t got = ::recv(fd, chunk, sizeof(chunk), 0);
                if (got <= 0) {
                    return -1;
                }
                pending.append(chunk, static_cast<std::size_t>(got));
            }
            const std::string line = pending.substr(0, newline);
            pending.erase(0, newline + 1);
            text += line + "\n";
            if (line.size() >= 4 && line[3] == ' ') {
                return std::atoi(line.substr(0, 3).c_str());
            }
            if (line.size() < 4) {
                return -1;
            }
        }
    }

    std::string dot_stuff(std::string_view message)
    {
        std::string out;
        bool line_start = true;
        for (const char letter: message) {
            if (line_start && letter == '.') {
                out.push_back('.');
            }
            out.push_back(letter);
            line_start = letter == '\n';
        }
        if (!out.ends_with("\r\n")) {
            out += "\r\n";
        }
        return out;
    }

    struct Connection
    {
        int fd{-1};

        ~Connection()
        {
            if (fd >= 0) {
                ::close(fd);
            }
        }
    };

} // namespace

Result<void> SpoolTransport::send(const Envelope& envelope, std::string_view message) const
{
    std::error_code error;
    std::filesystem::create_directories(m_directory, error);
    if (error) {
        return failure("cannot create " + m_directory + ": " + error.message());
    }
    const auto stamp = std::chrono::duration_cast<std::chrono::milliseconds>(
                           std::chrono::system_clock::now().time_since_epoch()
    )
                           .count();
    const std::string base = m_directory + "/" + std::to_string(stamp) + "-" + util::random_hex(4);
    {
        std::ofstream eml{base + ".eml", std::ios::binary};
        eml << message;
        if (!eml) {
            return failure("cannot write " + base + ".eml");
        }
    }
    std::ofstream info{base + ".envelope"};
    info << "from: " << envelope.get_from() << '\n';
    for (const std::string& recipient: envelope.get_recipients()) {
        info << "to: " << recipient << '\n';
    }
    return info ? Result<void>{} : failure("cannot write " + base + ".envelope");
}

Result<void> SendmailTransport::send(const Envelope& envelope, std::string_view message) const
{
    if (!safe_address(envelope.get_from()) || envelope.get_recipients().empty()) {
        return failure("bad envelope");
    }
    for (const std::string& recipient: envelope.get_recipients()) {
        if (!safe_address(recipient)) {
            return failure("bad recipient " + recipient);
        }
    }
    std::vector<std::string> arguments{m_program, "-i", "-f", envelope.get_from(), "--"};
    arguments.insert(
        arguments.end(),
        envelope.get_recipients().begin(),
        envelope.get_recipients().end()
    );
    std::vector<char*> argv;
    for (std::string& argument: arguments) {
        argv.push_back(argument.data());
    }
    argv.push_back(nullptr);

    int pipe_fds[2];
    if (::pipe(pipe_fds) != 0) {
        return failure(std::string("pipe: ") + std::strerror(errno));
    }
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, pipe_fds[0], STDIN_FILENO);
    posix_spawn_file_actions_addclose(&actions, pipe_fds[0]);
    posix_spawn_file_actions_addclose(&actions, pipe_fds[1]);
    pid_t pid = 0;
    const int spawned =
        ::posix_spawn(&pid, m_program.c_str(), &actions, nullptr, argv.data(), environ);
    posix_spawn_file_actions_destroy(&actions);
    ::close(pipe_fds[0]);
    if (spawned != 0) {
        ::close(pipe_fds[1]);
        return failure("cannot start " + m_program + ": " + std::strerror(spawned));
    }
    const bool written = write_all(pipe_fds[1], message);
    ::close(pipe_fds[1]);
    int status = 0;
    ::waitpid(pid, &status, 0);
    if (!written || !WIFEXITED(status) || WEXITSTATUS(status) != 0) {
        return failure(
            m_program + " failed (exit " +
            std::to_string(WIFEXITED(status) ? WEXITSTATUS(status) : -1) + ")"
        );
    }
    return {};
}

Result<void> SmtpTransport::send(const Envelope& envelope, std::string_view message) const
{
    if (!safe_address(envelope.get_from()) || envelope.get_recipients().empty()) {
        return failure("bad envelope");
    }
    for (const std::string& recipient: envelope.get_recipients()) {
        if (!safe_address(recipient)) {
            return failure("bad recipient " + recipient);
        }
    }
    addrinfo hints{};
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* found = nullptr;
    if (const int code = ::getaddrinfo(m_host.c_str(), m_port.c_str(), &hints, &found); code != 0) {
        return failure("cannot resolve " + m_host + ": " + ::gai_strerror(code));
    }
    Connection connection;
    for (const addrinfo* candidate = found; candidate != nullptr; candidate = candidate->ai_next) {
        const int fd =
            ::socket(candidate->ai_family, candidate->ai_socktype, candidate->ai_protocol);
        if (fd < 0) {
            continue;
        }
        if (::connect(fd, candidate->ai_addr, candidate->ai_addrlen) == 0) {
            connection.fd = fd;
            break;
        }
        ::close(fd);
    }
    ::freeaddrinfo(found);
    if (connection.fd < 0) {
        return failure("cannot connect to " + m_host + ":" + m_port);
    }
    timeval timeout{};
    timeout.tv_sec = 30;
    ::setsockopt(connection.fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));

    std::string reply;
    const auto expect = [&](int wanted, const std::string& step) -> Result<void>
    {
        const int code = read_reply(connection.fd, reply);
        if (code != wanted) {
            return failure("SMTP " + step + " failed: " + std::string(util::trim(reply)));
        }
        return {};
    };
    const auto command = [&](const std::string& line, int wanted, const std::string& step
                         ) -> Result<void>
    {
        if (!write_all(connection.fd, line + "\r\n")) {
            return failure("SMTP connection lost during " + step);
        }
        return expect(wanted, step);
    };

    if (auto step = expect(220, "greeting"); !step) {
        return step;
    }
    if (auto step = command("EHLO " + m_helo_name, 250, "EHLO"); !step) {
        return step;
    }
    if (auto step = command("MAIL FROM:<" + envelope.get_from() + ">", 250, "MAIL FROM"); !step) {
        return step;
    }
    for (const std::string& recipient: envelope.get_recipients()) {
        if (auto step = command("RCPT TO:<" + recipient + ">", 250, "RCPT TO"); !step) {
            return step;
        }
    }
    if (auto step = command("DATA", 354, "DATA"); !step) {
        return step;
    }
    if (!write_all(connection.fd, dot_stuff(message) + ".\r\n")) {
        return failure("SMTP connection lost while sending the message");
    }
    if (auto step = expect(250, "end of data"); !step) {
        return step;
    }
    (void)command("QUIT", 221, "QUIT");
    return {};
}

} // namespace nc::mail
