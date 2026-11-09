#include "ftp.h"

#include "http_client.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <arpa/inet.h>
#include <cstring>
#include <ctime>
#include <netdb.h>
#include <netinet/in.h>
#include <openssl/ssl.h>
#include <openssl/x509v3.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

namespace nc::cloud::ftp {

namespace {

    util::unexpected<std::string> failure(std::string message)
    {
        return util::unexpected<std::string>{std::move(message)};
    }

    /// A path or name that cannot carry a second command.
    bool clean(std::string_view text)
    {
        return text.find_first_of("\r\n") == std::string_view::npos &&
               text.find('\0') == std::string_view::npos && text.size() < 4'096;
    }

    /// Waits until the socket can be read (or written), at most `seconds`.
    bool wait(int fd, short events, int seconds)
    {
        pollfd waiting{fd, events, 0};
        return ::poll(&waiting, 1, seconds * 1'000) > 0;
    }

    std::int64_t parse_time(std::string_view stamp)
    {
        // YYYYMMDDHHMMSS[.sss]
        if (stamp.size() < 14) {
            return 0;
        }
        std::tm parts{};
        const std::string text{stamp.substr(0, 14)};
        if (strptime(text.c_str(), "%Y%m%d%H%M%S", &parts) == nullptr) {
            return 0;
        }
        return static_cast<std::int64_t>(timegm(&parts));
    }

    int connect_to(
        const std::string& host,
        const std::string& port,
        int seconds,
        bool allow_local,
        std::string& numeric_out,
        std::string& why
    )
    {
        addrinfo hints{};
        hints.ai_socktype = SOCK_STREAM;
        addrinfo* found = nullptr;
        if (::getaddrinfo(host.c_str(), port.c_str(), &hints, &found) != 0) {
            why = "cannot resolve " + host;
            return -1;
        }
        int fd = -1;
        bool refused = false;
        for (const addrinfo* candidate = found; candidate != nullptr && fd < 0;
             candidate = candidate->ai_next) {
            char numeric[INET6_ADDRSTRLEN] = {};
            const void* address =
                candidate->ai_family == AF_INET
                    ? static_cast<const void*>(
                          &reinterpret_cast<const sockaddr_in*>(candidate->ai_addr)->sin_addr
                      )
                    : static_cast<const void*>(
                          &reinterpret_cast<const sockaddr_in6*>(candidate->ai_addr)->sin6_addr
                      );
            ::inet_ntop(candidate->ai_family, address, numeric, sizeof(numeric));
            if (!allow_local && nc::federation::is_local_address(numeric)) {
                refused = true;
                continue;
            }
            const int attempt =
                ::socket(candidate->ai_family, candidate->ai_socktype, candidate->ai_protocol);
            if (attempt < 0) {
                continue;
            }
            timeval timeout{};
            timeout.tv_sec = seconds;
            ::setsockopt(attempt, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
            ::setsockopt(attempt, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
            if (::connect(attempt, candidate->ai_addr, candidate->ai_addrlen) == 0) {
                fd = attempt;
                numeric_out = numeric;
            } else {
                ::close(attempt);
            }
        }
        ::freeaddrinfo(found);
        if (fd < 0) {
            why = refused ? host + " is a local address" : "cannot connect to " + host + ":" + port;
        }
        return fd;
    }

    /// Reads from a socket, through TLS when there is a session. Blocking; the socket has a
    /// timeout.
    ssize_t read_from(int fd, ssl_st* tls, void* buffer, std::size_t size)
    {
        if (tls == nullptr) {
            return ::recv(fd, buffer, size, 0);
        }
        const int got = SSL_read(tls, buffer, static_cast<int>(size));
        return got > 0 ? got : 0;
    }

    /// Writes all of `data` to a socket, through TLS when there is a session.
    bool write_to(int fd, ssl_st* tls, std::string_view data)
    {
        while (!data.empty()) {
            const std::size_t piece = std::min<std::size_t>(data.size(), 1U << 16U);
            const ssize_t sent = tls == nullptr
                                     ? ::send(fd, data.data(), piece, MSG_NOSIGNAL)
                                     : SSL_write(tls, data.data(), static_cast<int>(piece));
            if (sent <= 0) {
                return false;
            }
            data.remove_prefix(static_cast<std::size_t>(sent));
        }
        return true;
    }

} // namespace

Result<Entry> parse_list_line(std::string_view line)
{
    line = util::trim(line);
    if (line.size() < 10 || (line[0] != '-' && line[0] != 'd' && line[0] != 'l')) {
        return failure("not an entry");
    }
    // Eight fields before the name: mode, links, owner, group, size, month, day, time-or-year.
    std::size_t at = 0;
    std::vector<std::string> fields;
    while (fields.size() < 8) {
        while (at < line.size() && line[at] == ' ') {
            ++at;
        }
        const std::size_t end = line.find(' ', at);
        if (end == std::string_view::npos) {
            return failure("not an entry");
        }
        fields.emplace_back(line.substr(at, end - at));
        at = end;
    }
    while (at < line.size() && line[at] == ' ') {
        ++at;
    }
    Entry entry;
    entry.name = std::string{line.substr(at)};
    entry.directory = line[0] == 'd';
    entry.size = std::strtoull(fields[4].c_str(), nullptr, 10);
    if (line[0] == 'l') {
        const std::size_t arrow = entry.name.find(" -> ");
        if (arrow != std::string::npos) {
            entry.name.resize(arrow);
        }
    }
    if (entry.name.empty() || entry.name == "." || entry.name == "..") {
        return failure("not an entry");
    }
    return entry;
}

Result<Entry> parse_mlsd_line(std::string_view line)
{
    line = util::trim(line);
    const std::size_t space = line.find(' ');
    if (space == std::string_view::npos) {
        return failure("not an entry");
    }
    Entry entry;
    entry.name = std::string{line.substr(space + 1)};
    std::string type;
    for (const std::string& fact: util::split(line.substr(0, space), ';')) {
        const std::size_t equals = fact.find('=');
        if (equals == std::string::npos) {
            continue;
        }
        const std::string key = util::to_lower(fact.substr(0, equals));
        const std::string value = fact.substr(equals + 1);
        if (key == "type") {
            type = util::to_lower(value);
        } else if (key == "size") {
            entry.size = std::strtoull(value.c_str(), nullptr, 10);
        } else if (key == "modify") {
            entry.modified = parse_time(value);
        }
    }
    if ((type != "file" && type != "dir") || entry.name.empty() || entry.name == "." ||
        entry.name == "..") {
        return failure("not an entry");
    }
    entry.directory = type == "dir";
    return entry;
}

/// One data connection: the socket and, for FTPS, its TLS session (of the control link's session,
/// so servers that insist on session reuse accept it).
struct Session::Link
{
    int fd{-1};
    ssl_st* tls{nullptr};

    Link() = default;
    Link(const Link&) = delete;
    Link& operator=(const Link&) = delete;

    ~Link()
    {
        finish();
    }

    /// Ends the transfer: a clean TLS shutdown, then the socket.
    void finish() noexcept
    {
        if (tls != nullptr) {
            SSL_shutdown(tls);
            SSL_free(tls);
            tls = nullptr;
        }
        if (fd >= 0) {
            ::close(fd);
            fd = -1;
        }
    }

    ssize_t read(void* buffer, std::size_t size) const
    {
        return read_from(fd, tls, buffer, size);
    }
};

Session::~Session()
{
    close();
}

Session::Session(Session&& other) noexcept :
    m_control{other.m_control},
    m_context{other.m_context},
    m_tls{other.m_tls},
    m_peer{std::move(other.m_peer)},
    m_buffer{std::move(other.m_buffer)},
    m_settings{other.m_settings},
    m_mlsd{other.m_mlsd}
{
    other.m_control = -1;
    other.m_context = nullptr;
    other.m_tls = nullptr;
}

Session& Session::operator=(Session&& other) noexcept
{
    if (this != &other) {
        close();
        m_control = other.m_control;
        m_context = std::exchange(other.m_context, nullptr);
        m_tls = std::exchange(other.m_tls, nullptr);
        m_peer = std::move(other.m_peer);
        m_buffer = std::move(other.m_buffer);
        m_settings = other.m_settings;
        m_mlsd = other.m_mlsd;
        other.m_control = -1;
    }
    return *this;
}

void Session::close()
{
    if (m_control >= 0) {
        (void)write_to(m_control, m_tls, "QUIT\r\n");
        if (m_tls != nullptr) {
            SSL_shutdown(m_tls);
            SSL_free(m_tls);
            m_tls = nullptr;
        }
        ::close(m_control);
        m_control = -1;
    }
    if (m_context != nullptr) {
        SSL_CTX_free(m_context);
        m_context = nullptr;
    }
}

Result<Session> Session::open(
    const std::string& host,
    const std::string& port,
    const std::string& user,
    const std::string& password,
    const Settings& settings
)
{
    if (!clean(user) || !clean(password)) {
        return failure("the account contains a line break");
    }
    Session session;
    session.m_settings = settings;
    std::string why;
    session.m_control =
        connect_to(host, port, settings.timeout_seconds, settings.allow_local, session.m_peer, why);
    if (session.m_control < 0) {
        return failure(why);
    }
    auto greeting = session.read_reply();
    if (!greeting || greeting->code != 220) {
        return failure("the server did not greet");
    }
    if (settings.secure) {
        // RFC 4217: ask for TLS before any credential is sent, check the server's certificate
        // against the name it was reached by, then protect the data links too.
        auto upgrade = session.command("AUTH TLS");
        if (!upgrade || upgrade->code != 234) {
            return failure("the server does not offer FTPS");
        }
        session.m_context = SSL_CTX_new(TLS_client_method());
        if (session.m_context == nullptr) {
            return failure("cannot create the TLS context");
        }
        SSL_CTX_set_min_proto_version(session.m_context, TLS1_2_VERSION);
        SSL_CTX_set_verify(session.m_context, SSL_VERIFY_PEER, nullptr);
        const bool loaded = settings.ca_file.empty()
                                ? SSL_CTX_set_default_verify_paths(session.m_context) == 1
                                : SSL_CTX_load_verify_locations(
                                      session.m_context,
                                      settings.ca_file.c_str(),
                                      nullptr
                                  ) == 1;
        if (!loaded) {
            return failure("cannot load the trusted certificates");
        }
        session.m_tls = SSL_new(session.m_context);
        if (session.m_tls == nullptr || SSL_set_fd(session.m_tls, session.m_control) != 1) {
            return failure("cannot start TLS");
        }
        SSL_set_tlsext_host_name(session.m_tls, host.c_str());
        X509_VERIFY_PARAM* params = SSL_get0_param(session.m_tls);
        in_addr v4{};
        in6_addr v6{};
        const bool is_ip = ::inet_pton(AF_INET, host.c_str(), &v4) == 1 ||
                           ::inet_pton(AF_INET6, host.c_str(), &v6) == 1;
        if ((is_ip ? X509_VERIFY_PARAM_set1_ip_asc(params, host.c_str())
                   : X509_VERIFY_PARAM_set1_host(params, host.data(), host.size())) != 1) {
            return failure("cannot check the certificate against " + host);
        }
        if (SSL_connect(session.m_tls) != 1) {
            const long verify = SSL_get_verify_result(session.m_tls);
            return failure(
                verify != X509_V_OK
                    ? std::string("the certificate of ") + host +
                          " is not trusted: " + X509_verify_cert_error_string(verify)
                    : "the TLS handshake with " + host + " failed"
            );
        }
        auto buffer_size = session.command("PBSZ 0");
        auto protect = session.command("PROT P");
        if (!buffer_size || buffer_size->code != 200 || !protect || protect->code != 200) {
            return failure("the server would not protect the data connections");
        }
    }
    auto name = session.command("USER " + user);
    if (!name) {
        return failure(name.error());
    }
    if (name->code == 331) {
        auto pass = session.command("PASS " + password);
        if (!pass || pass->code != 230) {
            return failure("the account was refused");
        }
    } else if (name->code != 230) {
        return failure("the account was refused");
    }
    auto binary = session.command("TYPE I");
    if (!binary || binary->code != 200) {
        return failure("the server does not take binary transfers");
    }
    return session;
}

Result<Session::Reply> Session::read_reply()
{
    Reply reply;
    while (true) {
        std::size_t eol;
        while ((eol = m_buffer.find("\r\n")) == std::string::npos) {
            // (A TLS session may hold bytes already; the socket's timeout covers a silent server.)
            if (m_tls == nullptr && !wait(m_control, POLLIN, m_settings.timeout_seconds)) {
                return failure("the server did not answer in time");
            }
            char chunk[2'048];
            const ssize_t got = read_from(m_control, m_tls, chunk, sizeof(chunk));
            if (got <= 0) {
                return failure("the server closed the connection");
            }
            m_buffer.append(chunk, static_cast<std::size_t>(got));
            if (m_buffer.size() > 65'536) {
                return failure("the server's answer is too long");
            }
        }
        const std::string line = m_buffer.substr(0, eol);
        m_buffer.erase(0, eol + 2);
        if (line.size() < 4 || !std::isdigit(static_cast<unsigned char>(line[0])) ||
            !std::isdigit(static_cast<unsigned char>(line[1])) ||
            !std::isdigit(static_cast<unsigned char>(line[2]))) {
            if (reply.code != 0) {
                reply.text += line + "\n"; // a continuation line without a code
                continue;
            }
            return failure("the server answered something unexpected");
        }
        const int code = std::atoi(line.substr(0, 3).c_str());
        if (reply.code == 0) {
            reply.code = code;
        }
        reply.text += line.substr(4) + "\n";
        // "123-" starts a multi-line reply, which ends with "123 ".
        if (line[3] == ' ' && code == reply.code) {
            return reply;
        }
    }
}

Result<Session::Reply> Session::command(const std::string& line)
{
    if (!clean(line)) {
        return failure("a name contains a line break");
    }
    const std::string wire = line + "\r\n";
    if (!write_to(m_control, m_tls, wire)) {
        return failure("the connection was lost");
    }
    return read_reply();
}

Result<std::unique_ptr<Session::Link>> Session::open_data_connection()
{
    // The server says where to connect, but only the port is used: the address is the one the
    // control connection already goes to (a server cannot send this client elsewhere).
    std::string port;
    auto extended = command("EPSV");
    if (extended && extended->code == 229) {
        const std::size_t open = extended->text.find("(|||");
        const std::size_t close = extended->text.find("|)", open);
        if (open != std::string::npos && close != std::string::npos) {
            port = extended->text.substr(open + 4, close - open - 4);
        }
    }
    if (port.empty()) {
        auto passive = command("PASV");
        if (!passive || passive->code != 227) {
            return failure("the server does not offer passive transfers");
        }
        const std::size_t open = passive->text.find('(');
        const std::size_t close = passive->text.find(')', open);
        if (open == std::string::npos || close == std::string::npos) {
            return failure("the server's passive answer is not understood");
        }
        const std::vector<std::string> numbers =
            util::split(passive->text.substr(open + 1, close - open - 1), ',');
        if (numbers.size() != 6) {
            return failure("the server's passive answer is not understood");
        }
        port = std::to_string(std::atoi(numbers[4].c_str()) * 256 + std::atoi(numbers[5].c_str()));
    }
    if (port.find_first_not_of("0123456789") != std::string::npos || port.empty() ||
        port.size() > 5) {
        return failure("the server's passive answer is not understood");
    }
    std::string numeric;
    std::string why;
    const int data = connect_to(m_peer, port, m_settings.timeout_seconds, true, numeric, why);
    if (data < 0) {
        return failure("cannot open the data connection");
    }
    auto link = std::make_unique<Link>();
    link->fd = data;
    return link;
}

Result<void> Session::secure_link(Link& link)
{
    if (m_tls == nullptr) {
        return {};
    }
    // Done after the transfer command, which is what makes the server accept the connection. The
    // session of the control link is resumed, as servers that require it insist.
    link.tls = SSL_new(m_context);
    if (link.tls == nullptr || SSL_set_fd(link.tls, link.fd) != 1) {
        return failure("cannot start TLS on the data connection");
    }
    SSL_set_session(link.tls, SSL_get_session(m_tls));
    if (SSL_connect(link.tls) != 1) {
        return failure("the TLS handshake of the data connection failed");
    }
    return {};
}

Result<std::string> Session::read_data(Link& data, std::size_t limit, std::uint64_t stop_after)
{
    std::string out;
    char chunk[16'384];
    while (true) {
        if (data.tls == nullptr && !wait(data.fd, POLLIN, m_settings.timeout_seconds)) {
            return failure("the transfer timed out");
        }
        const ssize_t got = data.read(chunk, sizeof(chunk));
        if (got < 0) {
            return failure("the transfer failed");
        }
        if (got == 0) {
            return out;
        }
        out.append(chunk, static_cast<std::size_t>(got));
        if (out.size() > limit) {
            return failure("the transfer is larger than allowed");
        }
        if (stop_after != 0 && out.size() >= stop_after) {
            out.resize(stop_after);
            return out;
        }
    }
}

Result<std::vector<Entry>> Session::list(const std::string& path)
{
    if (!clean(path)) {
        return failure("bad path");
    }
    for (int attempt = 0; attempt < 2; ++attempt) {
        const bool mlsd = m_mlsd;
        auto data = open_data_connection();
        if (!data) {
            return failure(data.error());
        }


        auto started = command((mlsd ? "MLSD " : "LIST ") + path);
        if (!started) {
            return failure(started.error());
        }
        if (started->code == 500 || started->code == 501 || started->code == 502) {
            if (mlsd) {
                m_mlsd = false; // this server has no MLSD: LIST
                continue;
            }
            return failure("the server refused to list " + path);
        }
        if (started->code != 150 && started->code != 125) {
            return failure("the folder " + path + " cannot be listed");
        }
        if (auto secured = secure_link(**data); !secured) {
            return failure(secured.error());
        }
        auto text = read_data(**data, 16U * 1'024U * 1'024U, 0);
        (*data)->finish();
        auto done = read_reply();
        if (!text) {
            return failure(text.error());
        }
        if (!done || done->code != 226) {
            return failure("the listing was not completed");
        }
        std::vector<Entry> entries;
        for (const std::string& line: util::split(*text, '\n')) {
            auto entry = mlsd ? parse_mlsd_line(line) : parse_list_line(line);
            if (entry && entry->name.find('/') == std::string::npos && entries.size() < 20'000) {
                entries.push_back(std::move(*entry));
            }
        }
        return entries;
    }
    return failure("the folder cannot be listed");
}

Result<std::string>
Session::retrieve(const std::string& path, std::uint64_t offset, std::uint64_t limit)
{
    if (!clean(path)) {
        return failure("bad path");
    }
    auto data = open_data_connection();
    if (!data) {
        return failure(data.error());
    }


    if (offset != 0) {
        auto restart = command("REST " + std::to_string(offset));
        if (!restart || restart->code != 350) {
            return failure("the server cannot continue a transfer");
        }
    }
    auto started = command("RETR " + path);
    if (!started) {
        return failure(started.error());
    }
    if (started->code == 550) {
        return failure("not found");
    }
    if (started->code != 150 && started->code != 125) {
        return failure("the file cannot be read");
    }
    if (auto secured = secure_link(**data); !secured) {
        return failure(secured.error());
    }
    auto text = read_data(**data, m_settings.max_bytes, limit);
    // The data connection ends here; with a limit the rest of the file is not wanted, and closing
    // ends the transfer.
    (*data)->finish();
    auto done = read_reply();
    if (!text) {
        return failure(text.error());
    }
    if (limit == 0 && (!done || done->code != 226)) {
        return failure("the transfer was not completed");
    }
    return text;
}

Result<void> Session::store(const std::string& path, std::string_view body)
{
    if (!clean(path)) {
        return failure("bad path");
    }
    auto data = open_data_connection();
    if (!data) {
        return failure(data.error());
    }


    auto started = command("STOR " + path);
    if (!started || (started->code != 150 && started->code != 125)) {
        return failure("the file cannot be written");
    }
    if (auto secured = secure_link(**data); !secured) {
        return failure(secured.error());
    }
    Link& link = **data;
    if (!write_to(link.fd, link.tls, body)) {
        return failure("the transfer failed");
    }
    link.finish();
    auto done = read_reply();
    if (!done || done->code != 226) {
        return failure("the file was not stored");
    }
    return {};
}

Result<void> Session::make_directory(const std::string& path)
{
    auto reply = command("MKD " + path);
    if (!reply || reply->code != 257) {
        return failure("the folder cannot be made");
    }
    return {};
}

Result<void> Session::remove_file(const std::string& path)
{
    auto reply = command("DELE " + path);
    if (!reply || reply->code != 250) {
        return failure("the file cannot be deleted");
    }
    return {};
}

Result<void> Session::remove_directory(const std::string& path)
{
    auto reply = command("RMD " + path);
    if (!reply || reply->code != 250) {
        return failure("the folder cannot be deleted");
    }
    return {};
}

Result<void> Session::rename(const std::string& from, const std::string& to)
{
    auto first = command("RNFR " + from);
    if (!first || first->code != 350) {
        return failure("the source cannot be renamed");
    }
    auto second = command("RNTO " + to);
    if (!second || second->code != 250) {
        return failure("the target cannot be used");
    }
    return {};
}

} // namespace nc::cloud::ftp
