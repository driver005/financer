#include "ftp.h"

#include "http_client.h"
#include "nextcloud/util/text.h"

#include <algorithm>
#include <arpa/inet.h>
#include <cstring>
#include <ctime>
#include <netdb.h>
#include <netinet/in.h>
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

Session::~Session()
{
    close();
}

Session::Session(Session&& other) noexcept :
    m_control{other.m_control},
    m_peer{std::move(other.m_peer)},
    m_buffer{std::move(other.m_buffer)},
    m_settings{other.m_settings},
    m_mlsd{other.m_mlsd}
{
    other.m_control = -1;
}

Session& Session::operator=(Session&& other) noexcept
{
    if (this != &other) {
        close();
        m_control = other.m_control;
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
        const char quit[] = "QUIT\r\n";
        (void)::send(m_control, quit, sizeof(quit) - 1, MSG_NOSIGNAL);
        ::close(m_control);
        m_control = -1;
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
            if (!wait(m_control, POLLIN, m_settings.timeout_seconds)) {
                return failure("the server did not answer in time");
            }
            char chunk[2'048];
            const ssize_t got = ::recv(m_control, chunk, sizeof(chunk), 0);
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
    if (::send(m_control, wire.data(), wire.size(), MSG_NOSIGNAL) !=
        static_cast<ssize_t>(wire.size())) {
        return failure("the connection was lost");
    }
    return read_reply();
}

Result<int> Session::open_data_connection()
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
    return data;
}

Result<std::string> Session::read_data(int data, std::size_t limit, std::uint64_t stop_after)
{
    std::string out;
    char chunk[16'384];
    while (true) {
        if (!wait(data, POLLIN, m_settings.timeout_seconds)) {
            return failure("the transfer timed out");
        }
        const ssize_t got = ::recv(data, chunk, sizeof(chunk), 0);
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

        struct Close
        {
            int fd;

            ~Close()
            {
                ::close(fd);
            }
        } closer{*data};

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
        auto text = read_data(*data, 16U * 1'024U * 1'024U, 0);
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

    struct Close
    {
        int fd;

        ~Close()
        {
            ::close(fd);
        }
    } closer{*data};

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
    auto text = read_data(*data, m_settings.max_bytes, limit);
    if (limit != 0 && text) {
        // The rest of the file is not wanted: closing the data connection ends the transfer.
        ::close(closer.fd);
        closer.fd = -1;
    }
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

    struct Close
    {
        int fd;

        ~Close()
        {
            ::close(fd);
        }
    } closer{*data};

    auto started = command("STOR " + path);
    if (!started || (started->code != 150 && started->code != 125)) {
        return failure("the file cannot be written");
    }
    std::string_view rest = body;
    while (!rest.empty()) {
        if (!wait(*data, POLLOUT, m_settings.timeout_seconds)) {
            return failure("the transfer timed out");
        }
        const ssize_t sent =
            ::send(*data, rest.data(), std::min<std::size_t>(rest.size(), 1U << 16U), MSG_NOSIGNAL);
        if (sent <= 0) {
            return failure("the transfer failed");
        }
        rest.remove_prefix(static_cast<std::size_t>(sent));
    }
    ::shutdown(*data, SHUT_WR);
    ::close(closer.fd);
    closer.fd = -1;
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
