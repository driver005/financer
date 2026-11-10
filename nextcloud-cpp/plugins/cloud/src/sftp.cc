#include "sftp.h"

#include "http_client.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"
#include "ssh_key.h"

#include <algorithm>
#include <arpa/inet.h>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <libssh2.h>
#include <libssh2_sftp.h>
#include <mutex>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

namespace nc::cloud::sftp {

namespace {

    util::unexpected<std::string> failure(std::string message)
    {
        return util::unexpected<std::string>{std::move(message)};
    }

    void initialise_library()
    {
        static std::once_flag once;
        std::call_once(
            once,
            []
            {
                libssh2_init(0);
            }
        );
    }

    /// libssh2 asks for the signature; the key signs with BoringSSL. The result is allocated the
    /// way libssh2 frees it (`libssh2_session_init` without allocators: malloc and free).
    int sign_with_key(
        LIBSSH2_SESSION* /*session*/,
        unsigned char** signature,
        std::size_t* length,
        const unsigned char* data,
        std::size_t data_length,
        void** abstract
    )
    {
        const auto& key = *static_cast<const SshKey*>(*abstract);
        const auto signed_data =
            key.sign(std::string_view{reinterpret_cast<const char*>(data), data_length});
        if (!signed_data) {
            return -1;
        }
        auto* copy = static_cast<unsigned char*>(std::malloc(signed_data->size()));
        if (copy == nullptr) {
            return -1;
        }
        std::memcpy(copy, signed_data->data(), signed_data->size());
        *signature = copy;
        *length = signed_data->size();
        return 0;
    }

    /// A path that cannot confuse the server.
    bool clean(std::string_view text)
    {
        return text.find('\0') == std::string_view::npos && text.size() < 4'096;
    }

    std::string strip_padding(std::string text)
    {
        while (!text.empty() && text.back() == '=') {
            text.pop_back();
        }
        return text;
    }

    int connect_to(
        const std::string& host,
        const std::string& port,
        int seconds,
        bool allow_local,
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

    LIBSSH2_SESSION* session_of(void* handle) noexcept
    {
        return static_cast<LIBSSH2_SESSION*>(handle);
    }

    LIBSSH2_SFTP* sftp_of(void* handle) noexcept
    {
        return static_cast<LIBSSH2_SFTP*>(handle);
    }

    std::string describe(void* session, std::string_view what)
    {
        char* message = nullptr;
        int length = 0;
        const int code = libssh2_session_last_error(session_of(session), &message, &length, 0);
        return std::string{what} + " (" + std::to_string(code) + ")" +
               (message != nullptr ? ": " + std::string{message, static_cast<std::size_t>(length)}
                                   : std::string{});
    }

} // namespace

Session::~Session()
{
    close();
}

Session::Session(Session&& other) noexcept :
    m_socket{std::exchange(other.m_socket, -1)},
    m_session{std::exchange(other.m_session, nullptr)},
    m_sftp{std::exchange(other.m_sftp, nullptr)},
    m_settings{other.m_settings}
{
}

Session& Session::operator=(Session&& other) noexcept
{
    if (this != &other) {
        close();
        m_socket = std::exchange(other.m_socket, -1);
        m_session = std::exchange(other.m_session, nullptr);
        m_sftp = std::exchange(other.m_sftp, nullptr);
        m_settings = other.m_settings;
    }
    return *this;
}

void Session::close() noexcept
{
    if (m_sftp != nullptr) {
        libssh2_sftp_shutdown(sftp_of(m_sftp));
        m_sftp = nullptr;
    }
    if (m_session != nullptr) {
        libssh2_session_disconnect(session_of(m_session), "bye");
        libssh2_session_free(session_of(m_session));
        m_session = nullptr;
    }
    if (m_socket >= 0) {
        ::close(m_socket);
        m_socket = -1;
    }
}

Result<Session> Session::open(
    const std::string& host,
    const std::string& port,
    const std::string& user,
    const std::string& password,
    const std::string& host_key_sha256,
    const std::string& private_key_file,
    const Settings& settings
)
{
    initialise_library();
    if (!clean(user) || password.find('\0') != std::string::npos || host_key_sha256.empty() ||
        private_key_file.find('\0') != std::string::npos) {
        return failure("the account or the host key is missing");
    }
    Session session;
    session.m_settings = settings;
    std::string why;
    session.m_socket = connect_to(host, port, settings.timeout_seconds, settings.allow_local, why);
    if (session.m_socket < 0) {
        return failure(why);
    }
    session.m_session = libssh2_session_init();
    if (session.m_session == nullptr) {
        return failure("cannot start the SSH session");
    }
    LIBSSH2_SESSION* ssh = session_of(session.m_session);
    libssh2_session_set_blocking(ssh, 1);
    libssh2_session_set_timeout(ssh, static_cast<long>(settings.timeout_seconds) * 1'000);
    if (libssh2_session_handshake(ssh, session.m_socket) != 0) {
        return failure(describe(session.m_session, "the SSH handshake failed"));
    }
    // The server must have the key the administrator pinned.
    const char* hash = libssh2_hostkey_hash(ssh, LIBSSH2_HOSTKEY_HASH_SHA256);
    if (hash == nullptr) {
        return failure("the server sent no host key");
    }
    const std::string seen = strip_padding(util::base64_encode(std::string_view{hash, 32}));
    if (seen != strip_padding(host_key_sha256)) {
        return failure("the host key of " + host + " is not the pinned one (SHA256:" + seen + ")");
    }
    // Only after the host key matched: neither the password nor a signature goes to a stranger.
    int signed_in = 0;
    if (private_key_file.empty()) {
        signed_in = libssh2_userauth_password(ssh, user.c_str(), password.c_str());
    } else {
        std::ifstream file{private_key_file, std::ios::binary};
        const std::string text{std::istreambuf_iterator<char>{file}, {}};
        auto key = SshKey::parse(text, password);
        if (!key) {
            return failure(key.error());
        }
        const std::string blob = key->public_blob();
        void* abstract = &*key;
        signed_in = libssh2_userauth_publickey(
            ssh,
            user.c_str(),
            reinterpret_cast<const unsigned char*>(blob.data()),
            blob.size(),
            &sign_with_key,
            &abstract
        );
    }
    if (signed_in != 0) {
        return failure(describe(session.m_session, "the account was refused"));
    }
    session.m_sftp = libssh2_sftp_init(ssh);
    if (session.m_sftp == nullptr) {
        return failure(describe(session.m_session, "the server does not offer SFTP"));
    }
    return session;
}

Result<std::vector<Entry>> Session::list(const std::string& path)
{
    if (!clean(path)) {
        return failure("bad path");
    }
    LIBSSH2_SFTP_HANDLE* directory = libssh2_sftp_opendir(sftp_of(m_sftp), path.c_str());
    if (directory == nullptr) {
        return failure(describe(m_session, "cannot list " + path));
    }
    std::vector<Entry> entries;
    char name[1'024];
    while (true) {
        LIBSSH2_SFTP_ATTRIBUTES attributes{};
        const int length = libssh2_sftp_readdir(directory, name, sizeof(name), &attributes);
        if (length < 0) {
            libssh2_sftp_closedir(directory);
            return failure(describe(m_session, "cannot read " + path));
        }
        if (length == 0) {
            break;
        }
        const std::string entry_name{name, static_cast<std::size_t>(length)};
        if (entry_name == "." || entry_name == ".." || entry_name.find('/') != std::string::npos) {
            continue;
        }
        Entry entry;
        entry.name = entry_name;
        entry.directory = (attributes.flags & LIBSSH2_SFTP_ATTR_PERMISSIONS) != 0 &&
                          LIBSSH2_SFTP_S_ISDIR(attributes.permissions);
        entry.size = (attributes.flags & LIBSSH2_SFTP_ATTR_SIZE) != 0 ? attributes.filesize : 0;
        entry.modified = (attributes.flags & LIBSSH2_SFTP_ATTR_ACMODTIME) != 0
                             ? static_cast<std::int64_t>(attributes.mtime)
                             : 0;
        entries.push_back(std::move(entry));
    }
    libssh2_sftp_closedir(directory);
    return entries;
}

Result<std::string>
Session::retrieve(const std::string& path, std::uint64_t offset, std::uint64_t limit)
{
    if (!clean(path)) {
        return failure("bad path");
    }
    LIBSSH2_SFTP_HANDLE* file =
        libssh2_sftp_open(sftp_of(m_sftp), path.c_str(), LIBSSH2_FXF_READ, 0);
    if (file == nullptr) {
        return failure(describe(m_session, "cannot open " + path));
    }
    if (offset != 0) {
        libssh2_sftp_seek64(file, offset);
    }
    std::string out;
    char chunk[32'768];
    while (limit == 0 || out.size() < limit) {
        const std::size_t want =
            limit == 0 ? sizeof(chunk) : std::min<std::uint64_t>(sizeof(chunk), limit - out.size());
        const ssize_t got = libssh2_sftp_read(file, chunk, want);
        if (got < 0) {
            libssh2_sftp_close(file);
            return failure(describe(m_session, "cannot read " + path));
        }
        if (got == 0) {
            break;
        }
        out.append(chunk, static_cast<std::size_t>(got));
        if (out.size() > m_settings.max_bytes) {
            libssh2_sftp_close(file);
            return failure("the file is larger than allowed");
        }
    }
    libssh2_sftp_close(file);
    return out;
}

Result<void> Session::store(const std::string& path, std::string_view data)
{
    if (!clean(path)) {
        return failure("bad path");
    }
    LIBSSH2_SFTP_HANDLE* file = libssh2_sftp_open(
        sftp_of(m_sftp),
        path.c_str(),
        LIBSSH2_FXF_WRITE | LIBSSH2_FXF_CREAT | LIBSSH2_FXF_TRUNC,
        LIBSSH2_SFTP_S_IRUSR | LIBSSH2_SFTP_S_IWUSR | LIBSSH2_SFTP_S_IRGRP | LIBSSH2_SFTP_S_IROTH
    );
    if (file == nullptr) {
        return failure(describe(m_session, "cannot write " + path));
    }
    while (!data.empty()) {
        const ssize_t written = libssh2_sftp_write(file, data.data(), data.size());
        if (written <= 0) {
            libssh2_sftp_close(file);
            return failure(describe(m_session, "cannot write " + path));
        }
        data.remove_prefix(static_cast<std::size_t>(written));
    }
    libssh2_sftp_close(file);
    return {};
}

Result<void> Session::make_directory(const std::string& path)
{
    if (!clean(path) || libssh2_sftp_mkdir(
                            sftp_of(m_sftp),
                            path.c_str(),
                            LIBSSH2_SFTP_S_IRWXU | LIBSSH2_SFTP_S_IRGRP | LIBSSH2_SFTP_S_IXGRP |
                                LIBSSH2_SFTP_S_IROTH | LIBSSH2_SFTP_S_IXOTH
                        ) != 0) {
        return failure(describe(m_session, "cannot create " + path));
    }
    return {};
}

Result<void> Session::remove_file(const std::string& path)
{
    if (!clean(path) || libssh2_sftp_unlink(sftp_of(m_sftp), path.c_str()) != 0) {
        return failure(describe(m_session, "cannot delete " + path));
    }
    return {};
}

Result<void> Session::remove_directory(const std::string& path)
{
    if (!clean(path) || libssh2_sftp_rmdir(sftp_of(m_sftp), path.c_str()) != 0) {
        return failure(describe(m_session, "cannot delete " + path));
    }
    return {};
}

Result<void> Session::rename(const std::string& from, const std::string& to)
{
    if (!clean(from) || !clean(to) ||
        libssh2_sftp_rename_ex(
            sftp_of(m_sftp),
            from.c_str(),
            static_cast<unsigned int>(from.size()),
            to.c_str(),
            static_cast<unsigned int>(to.size()),
            LIBSSH2_SFTP_RENAME_OVERWRITE | LIBSSH2_SFTP_RENAME_ATOMIC | LIBSSH2_SFTP_RENAME_NATIVE
        ) != 0) {
        return failure(describe(m_session, "cannot move " + from));
    }
    return {};
}

} // namespace nc::cloud::sftp
