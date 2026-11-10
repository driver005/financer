#include "transport.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

#include <arpa/inet.h>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <netdb.h>
#include <openssl/err.h>
#include <openssl/ssl.h>
#include <openssl/x509.h>
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

    /// The connection to a relay: a socket, and TLS on top of it once that was asked for. Closes
    /// whatever it holds.
    class Stream
    {
    public:
        explicit Stream(int fd) noexcept :
            m_fd{fd}
        {
        }

        Stream(const Stream&) = delete;
        Stream& operator=(const Stream&) = delete;

        ~Stream()
        {
            if (m_tls != nullptr) {
                SSL_shutdown(m_tls);
                SSL_free(m_tls);
            }
            if (m_context != nullptr) {
                SSL_CTX_free(m_context);
            }
            if (m_fd >= 0) {
                ::close(m_fd);
            }
        }

        [[nodiscard]] bool secure() const noexcept
        {
            return m_tls != nullptr;
        }

        bool write(std::string_view data) noexcept
        {
            while (!data.empty()) {
                const std::size_t piece = std::min<std::size_t>(data.size(), 16U * 1'024U);
                const ssize_t written = m_tls != nullptr
                                            ? SSL_write(m_tls, data.data(), static_cast<int>(piece))
                                            : ::send(m_fd, data.data(), piece, MSG_NOSIGNAL);
                if (written <= 0) {
                    if (m_tls == nullptr && written < 0 && errno == EINTR) {
                        continue;
                    }
                    return false;
                }
                data.remove_prefix(static_cast<std::size_t>(written));
            }
            return true;
        }

        ssize_t read(char* buffer, std::size_t size) noexcept
        {
            return m_tls != nullptr ? SSL_read(m_tls, buffer, static_cast<int>(size))
                                    : ::recv(m_fd, buffer, size, 0);
        }

        /// Starts TLS on the connection: TLS 1.2 or later, the certificate must verify against
        /// `ca_file` (the system's certificates when empty) and name `host`.
        Result<void> start_tls(const std::string& host, const std::string& ca_file)
        {
            m_context = SSL_CTX_new(TLS_client_method());
            if (m_context == nullptr) {
                return failure("cannot create the TLS context");
            }
            SSL_CTX_set_min_proto_version(m_context, TLS1_2_VERSION);
            SSL_CTX_set_verify(m_context, SSL_VERIFY_PEER, nullptr);
            const bool loaded =
                ca_file.empty()
                    ? SSL_CTX_set_default_verify_paths(m_context) == 1
                    : SSL_CTX_load_verify_locations(m_context, ca_file.c_str(), nullptr) == 1;
            if (!loaded) {
                return failure("cannot load the trusted certificates");
            }
            m_tls = SSL_new(m_context);
            if (m_tls == nullptr || SSL_set_fd(m_tls, m_fd) != 1) {
                return failure("cannot start TLS");
            }
            SSL_set_tlsext_host_name(m_tls, host.c_str());
            X509_VERIFY_PARAM* params = SSL_get0_param(m_tls);
            in_addr v4{};
            in6_addr v6{};
            const bool is_ip = ::inet_pton(AF_INET, host.c_str(), &v4) == 1 ||
                               ::inet_pton(AF_INET6, host.c_str(), &v6) == 1;
            if ((is_ip ? X509_VERIFY_PARAM_set1_ip_asc(params, host.c_str())
                       : X509_VERIFY_PARAM_set1_host(params, host.data(), host.size())) != 1) {
                return failure("cannot check the certificate against " + host);
            }
            if (SSL_connect(m_tls) != 1) {
                const long verify = SSL_get_verify_result(m_tls);
                SSL_free(m_tls);
                m_tls = nullptr;
                return failure(
                    verify != X509_V_OK
                        ? std::string("the certificate of ") + host +
                              " is not trusted: " + X509_verify_cert_error_string(verify)
                        : "the TLS handshake with " + host + " failed"
                );
            }
            return {};
        }

        void set_timeouts(int seconds) noexcept
        {
            timeval timeout{};
            timeout.tv_sec = seconds;
            ::setsockopt(m_fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
            ::setsockopt(m_fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
        }

    private:
        int m_fd{-1};
        SSL_CTX* m_context{nullptr};
        SSL* m_tls{nullptr};
    };

    /// Reads one SMTP reply (possibly several `250-` lines); returns its code, or -1 on a broken
    /// connection.
    int read_reply(Stream& stream, std::string& text)
    {
        text.clear();
        std::string pending;
        while (true) {
            std::size_t newline;
            while ((newline = pending.find('\n')) == std::string::npos) {
                char chunk[1'024];
                const ssize_t got = stream.read(chunk, sizeof(chunk));
                if (got <= 0) {
                    return -1;
                }
                pending.append(chunk, static_cast<std::size_t>(got));
            }
            std::string line = pending.substr(0, newline);
            pending.erase(0, newline + 1);
            while (line.ends_with('\r')) {
                line.pop_back();
            }
            text += line + "\n";
            if (line.size() >= 4 && line[3] == ' ') {
                return std::atoi(line.substr(0, 3).c_str());
            }
            if (line.size() < 4) {
                return -1;
            }
        }
    }

    /// Whether the EHLO reply `text` lists `keyword` (`starttls`) and, if given, the word `option`
    /// after it (`AUTH PLAIN LOGIN`, or the older `AUTH=PLAIN`). Lower case in, case ignored.
    bool offers(std::string_view text, std::string_view keyword, std::string_view option = {})
    {
        std::size_t at = 0;
        while (at < text.size()) {
            std::size_t end = text.find('\n', at);
            end = end == std::string_view::npos ? text.size() : end;
            std::string_view line = text.substr(at, end - at);
            at = end + 1;
            if (line.size() < 4) {
                continue;
            }
            line.remove_prefix(4);
            const std::string lower = util::to_lower(line);
            if (!lower.starts_with(keyword)) {
                continue;
            }
            if (option.empty()) {
                return true;
            }
            for (const std::string& word: util::split(lower, ' ')) {
                if (word == option || word == std::string{keyword} + "=" + std::string{option}) {
                    return true;
                }
            }
        }
        return false;
    }

    bool is_local_host(std::string_view host) noexcept
    {
        return host == "localhost" || host == "::1" || host.starts_with("127.");
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
    const SmtpSettings& settings = m_settings;
    const bool authenticate = !settings.username.empty();
    // A password never goes over a connection anyone on the way can read: that is TLS, or this
    // machine.
    if (authenticate && settings.security == SmtpSecurity::NONE && !is_local_host(settings.host)) {
        return failure(
            "refusing to send the SMTP password to " + settings.host +
            " without TLS (set smtp_security to starttls or tls)"
        );
    }
    if (settings.username.find_first_of("\r\n") != std::string::npos ||
        settings.password.find_first_of("\r\n") != std::string::npos) {
        return failure("the SMTP credentials contain a line break");
    }
    addrinfo hints{};
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* found = nullptr;
    if (const int code =
            ::getaddrinfo(settings.host.c_str(), settings.port.c_str(), &hints, &found);
        code != 0) {
        return failure("cannot resolve " + settings.host + ": " + ::gai_strerror(code));
    }
    int connected = -1;
    for (const addrinfo* candidate = found; candidate != nullptr; candidate = candidate->ai_next) {
        const int fd =
            ::socket(candidate->ai_family, candidate->ai_socktype, candidate->ai_protocol);
        if (fd < 0) {
            continue;
        }
        if (::connect(fd, candidate->ai_addr, candidate->ai_addrlen) == 0) {
            connected = fd;
            break;
        }
        ::close(fd);
    }
    ::freeaddrinfo(found);
    if (connected < 0) {
        return failure("cannot connect to " + settings.host + ":" + settings.port);
    }
    Stream stream{connected};
    stream.set_timeouts(30);

    std::string reply;
    const auto expect = [&](int wanted, const std::string& step) -> Result<void>
    {
        const int code = read_reply(stream, reply);
        if (code != wanted) {
            return failure("SMTP " + step + " failed: " + std::string(util::trim(reply)));
        }
        return {};
    };
    const auto command = [&](const std::string& line, int wanted, const std::string& step
                         ) -> Result<void>
    {
        if (!stream.write(line + "\r\n")) {
            return failure("SMTP connection lost during " + step);
        }
        return expect(wanted, step);
    };

    if (settings.security == SmtpSecurity::TLS) {
        if (auto step = stream.start_tls(settings.host, settings.ca_file); !step) {
            return step;
        }
    }
    if (auto step = expect(220, "greeting"); !step) {
        return step;
    }
    if (auto step = command("EHLO " + settings.helo_name, 250, "EHLO"); !step) {
        return step;
    }
    if (settings.security == SmtpSecurity::STARTTLS) {
        // Never carry on in the clear when TLS was asked for.
        if (!offers(reply, "starttls")) {
            return failure("the relay " + settings.host + " does not offer STARTTLS");
        }
        if (auto step = command("STARTTLS", 220, "STARTTLS"); !step) {
            return step;
        }
        if (auto step = stream.start_tls(settings.host, settings.ca_file); !step) {
            return step;
        }
        // What the relay offers is asked again: the first answer was not protected.
        if (auto step = command("EHLO " + settings.helo_name, 250, "EHLO"); !step) {
            return step;
        }
    }
    if (authenticate) {
        if (offers(reply, "auth", "plain")) {
            const std::string token = util::base64_encode(
                std::string{'\0'} + settings.username + '\0' + settings.password
            );
            if (auto step = command("AUTH PLAIN " + token, 235, "authentication"); !step) {
                return failure("SMTP authentication failed");
            }
        } else if (offers(reply, "auth", "login")) {
            if (auto step = command("AUTH LOGIN", 334, "authentication"); !step) {
                return failure("SMTP authentication failed");
            }
            if (auto step = command(util::base64_encode(settings.username), 334, "authentication");
                !step) {
                return failure("SMTP authentication failed");
            }
            if (auto step = command(util::base64_encode(settings.password), 235, "authentication");
                !step) {
                return failure("SMTP authentication failed");
            }
        } else {
            return failure("the relay offers no authentication this server can use (PLAIN, LOGIN)");
        }
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
    if (!stream.write(dot_stuff(message) + ".\r\n")) {
        return failure("SMTP connection lost while sending the message");
    }
    if (auto step = expect(250, "end of data"); !step) {
        return step;
    }
    (void)command("QUIT", 221, "QUIT");
    return {};
}

} // namespace nc::mail
