#include "mime.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "transport.h"

#include <arpa/inet.h>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <netinet/in.h>
#include <openssl/ssl.h>
#include <sstream>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>

namespace {

using nc::http::Request;
using nc::http::Response;
using nc::mail::MailMessage;

std::string temp_dir(const std::string& name)
{
    const std::filesystem::path path = std::filesystem::temp_directory_path() /
                                       ("nc-mail-" + name + "-" + nc::util::random_hex(4));
    std::filesystem::create_directories(path);
    return path.string();
}

std::string slurp(const std::filesystem::path& path)
{
    std::ifstream stream{path, std::ios::binary};
    std::ostringstream text;
    text << stream.rdbuf();
    return text.str();
}

std::vector<std::filesystem::path> files_with(const std::string& dir, const std::string& extension)
{
    std::vector<std::filesystem::path> found;
    if (std::filesystem::exists(dir)) {
        for (const auto& entry: std::filesystem::directory_iterator{dir}) {
            if (entry.path().extension() == extension) {
                found.push_back(entry.path());
            }
        }
    }
    return found;
}

void test_headers_and_body()
{
    using namespace nc::mail;
    NC_CHECK_EQ(encode_header_value("plain"), "plain");
    NC_CHECK_EQ(encode_header_value("Grüße"), "=?UTF-8?B?R3LDvMOfZQ==?=");
    // A long non-ASCII subject becomes several words, none cut inside a character.
    const std::string long_subject(
        60,
        '\xC3'
    ); // not valid UTF-8 on purpose: still must not loop or crash
    NC_CHECK(!encode_header_value(long_subject).empty());
    const std::string wrapped = wrap_base64(std::string(100, 'a'));
    NC_CHECK_EQ(wrapped.find("\r\n"), std::size_t{76});

    MailMessage message{"cloud@example.org", "Hello"};
    message.set_from_name("Our Cloud");
    message.add_to("a@example.org")
        .add_to("b@example.org")
        .add_cc("c@example.org")
        .add_bcc("secret@example.org");
    message.set_plain_body("Line one\nLine two");
    const auto plain = build_message(message, std::chrono::system_clock::time_point{}, "seed");
    NC_CHECK(plain.has_value());
    if (plain) {
        NC_CHECK(plain->find("From: Our Cloud <cloud@example.org>\r\n") != std::string::npos);
        NC_CHECK(plain->find("To: a@example.org, b@example.org\r\n") != std::string::npos);
        NC_CHECK(plain->find("Cc: c@example.org\r\n") != std::string::npos);
        NC_CHECK(
            plain->find("secret@example.org") == std::string::npos
        ); // Bcc is never in the headers
        NC_CHECK(plain->find("Date: Thu, 01 Jan 1970 00:00:00 +0000\r\n") != std::string::npos);
        NC_CHECK(plain->find("Content-Type: text/plain; charset=utf-8\r\n") != std::string::npos);
        NC_CHECK(plain->find("Message-ID: <") != std::string::npos);
        NC_CHECK(
            plain->find("TGluZSBvbmUNCkxpbmUgdHdv") != std::string::npos
        ); // "Line one\r\nLine two"
    }

    message.set_html_body("<p>Hi</p>");
    const auto alternative =
        build_message(message, std::chrono::system_clock::time_point{}, "seed");
    NC_CHECK(alternative.has_value());
    if (alternative) {
        NC_CHECK(
            alternative->find("multipart/alternative; boundary=\"=_nc_seed\"") != std::string::npos
        );
        NC_CHECK(alternative->find("--=_nc_seed--\r\n") != std::string::npos);
        NC_CHECK(alternative->find("text/html") != std::string::npos);
    }

    // The builder gives the same message as the setters.
    MailMessage built = nc::mail::MailMessageBuilder{}
                            .from("cloud@example.org")
                            .from_name("Our Cloud")
                            .to("a@example.org")
                            .to("b@example.org")
                            .cc("c@example.org")
                            .bcc("secret@example.org")
                            .subject("Hello")
                            .plain_body("Line one\nLine two")
                            .html_body("<p>Hi</p>")
                            .build();
    NC_CHECK_EQ(built.get_from(), "cloud@example.org");
    NC_CHECK_EQ(built.get_to().size(), std::size_t{2});
    NC_CHECK_EQ(built.recipients().size(), std::size_t{4});
    const auto from_builder = build_message(built, std::chrono::system_clock::time_point{}, "seed");
    NC_CHECK(from_builder.has_value());
    if (from_builder && alternative) {
        // Everything but the random Message-ID line is the same.
        const auto without_id = [](std::string text)
        {
            const std::size_t at = text.find("Message-ID: <");
            text.erase(at, text.find("\r\n", at) + 2 - at);
            return text;
        };
        NC_CHECK(without_id(*from_builder) == without_id(*alternative));
    }
    nc::mail::MailMessageBuilder reused;
    reused.from("x@example.org").to("y@example.org");
    NC_CHECK_EQ(reused.build().get_to().size(), std::size_t{1});
    NC_CHECK(reused.build().get_to().empty()); // emptied by build()

    // Everything that could inject a header or a recipient is refused.
    MailMessage bad_subject = message;
    bad_subject.set_subject("Hi\r\nBcc: evil@example.org");
    NC_CHECK(!build_message(bad_subject).has_value());
    MailMessage bad_to = message;
    bad_to.add_to("x@example.org\r\nBcc: evil@example.org");
    NC_CHECK(!build_message(bad_to).has_value());
    MailMessage no_one{"cloud@example.org", "Hi"};
    no_one.set_plain_body("x");
    NC_CHECK(!build_message(no_one).has_value());
    MailMessage no_body{"cloud@example.org", "Hi"};
    no_body.add_to("a@example.org");
    NC_CHECK(!build_message(no_body).has_value());
}

void test_spool_and_null()
{
    const std::string dir = temp_dir("spool");
    const nc::mail::SpoolTransport spool{dir + "/out"};
    NC_CHECK(spool
                 .send(
                     nc::mail::Envelope{"a@example.org", {"b@example.org", "c@example.org"}},
                     "Subject: x\r\n\r\nbody\r\n"
                 )
                 .has_value());
    NC_CHECK_EQ(files_with(dir + "/out", ".eml").size(), std::size_t{1});
    const auto envelopes = files_with(dir + "/out", ".envelope");
    NC_CHECK_EQ(envelopes.size(), std::size_t{1});
    if (!envelopes.empty()) {
        NC_CHECK_EQ(
            slurp(envelopes[0]),
            "from: a@example.org\nto: b@example.org\nto: c@example.org\n"
        );
    }
    NC_CHECK(nc::mail::NullTransport{}.send(nc::mail::Envelope{}, "").has_value());
    std::filesystem::remove_all(dir);
}

/// A throwaway certificate (key and certificate files) for the relay below, made with `openssl`.
struct Certificate
{
    std::string dir{};
    std::string cert{};
    std::string key{};

    explicit Certificate(const std::string& names)
    {
        dir = temp_dir("tls");
        cert = dir + "/cert.pem";
        key = dir + "/key.pem";
        const std::string command =
            "openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=relay -addext "
            "\"subjectAltName=" +
            names + "\" -keyout " + key + " -out " + cert + " >/dev/null 2>&1";
        NC_CHECK_EQ(std::system(command.c_str()), 0);
    }

    ~Certificate()
    {
        std::filesystem::remove_all(dir);
    }

    Certificate(const Certificate&) = delete;
    Certificate& operator=(const Certificate&) = delete;
};

/// A relay that accepts one mail and records the conversation. It can speak TLS (from the first
/// byte, or after STARTTLS) and ask for AUTH PLAIN / LOGIN.
class FakeSmtpServer
{
public:
    enum class Tls
    {
        NONE,
        STARTTLS,
        IMPLICIT
    };

    explicit FakeSmtpServer(Tls tls = Tls::NONE, const Certificate* certificate = nullptr) :
        m_tls{tls}
    {
        if (certificate != nullptr) {
            m_context = SSL_CTX_new(TLS_server_method());
            NC_CHECK(
                SSL_CTX_use_certificate_chain_file(m_context, certificate->cert.c_str()) == 1 &&
                SSL_CTX_use_PrivateKey_file(
                    m_context,
                    certificate->key.c_str(),
                    SSL_FILETYPE_PEM
                ) == 1
            );
        }
        m_listen = ::socket(AF_INET, SOCK_STREAM, 0);
        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        ::bind(m_listen, reinterpret_cast<sockaddr*>(&address), sizeof(address));
        ::listen(m_listen, 1);
        socklen_t size = sizeof(address);
        ::getsockname(m_listen, reinterpret_cast<sockaddr*>(&address), &size);
        m_port = ntohs(address.sin_port);
        m_thread = std::thread{[this]
                               {
                                   serve();
                               }};
    }

    ~FakeSmtpServer()
    {
        ::shutdown(m_listen, SHUT_RDWR);
        ::close(m_listen);
        m_thread.join();
        if (m_context != nullptr) {
            SSL_CTX_free(m_context);
        }
    }

    [[nodiscard]] std::string port() const
    {
        return std::to_string(m_port);
    }

    [[nodiscard]] const std::string& transcript() const
    {
        return m_transcript;
    }

    [[nodiscard]] bool delivered() const
    {
        return m_delivered;
    }

    bool reject_recipient{false};
    bool offer_starttls{true};
    std::string auth_mechanisms{}; ///< "PLAIN LOGIN": asks for a sign-in, empty: none
    std::string user{"mailer"};
    std::string password{"s3cret"};

private:
    struct Line
    {
        int fd{-1};
        SSL* ssl{nullptr};
        std::string pending{};

        void send(const std::string& text) const
        {
            if (ssl != nullptr) {
                SSL_write(ssl, text.data(), static_cast<int>(text.size()));
            } else {
                ::send(fd, text.data(), text.size(), MSG_NOSIGNAL);
            }
        }

        bool next(std::string& line)
        {
            std::size_t newline;
            while ((newline = pending.find("\r\n")) == std::string::npos) {
                char chunk[4'096];
                const ssize_t got = ssl != nullptr ? SSL_read(ssl, chunk, sizeof(chunk))
                                                   : ::recv(fd, chunk, sizeof(chunk), 0);
                if (got <= 0) {
                    return false;
                }
                pending.append(chunk, static_cast<std::size_t>(got));
            }
            line = pending.substr(0, newline);
            pending.erase(0, newline + 2);
            return true;
        }
    };

    static std::string plain_login(const std::string& user, const std::string& password)
    {
        return nc::util::base64_encode(std::string{'\0'} + user + '\0' + password);
    }

    void serve()
    {
        const int client = ::accept(m_listen, nullptr, nullptr);
        if (client < 0) {
            return;
        }
        Line io{client};
        const auto finish = [&]
        {
            if (io.ssl != nullptr) {
                SSL_free(io.ssl);
            }
            ::close(client);
        };
        const auto start_tls = [&]
        {
            io.ssl = SSL_new(m_context);
            SSL_set_fd(io.ssl, client);
            if (SSL_accept(io.ssl) != 1) {
                SSL_free(io.ssl);
                io.ssl = nullptr;
                return false;
            }
            return true;
        };
        if (m_tls == Tls::IMPLICIT && !start_tls()) {
            ::close(client);
            return;
        }
        io.send("220 fake ESMTP\r\n");
        bool in_data = false;
        bool signed_in = auth_mechanisms.empty();
        int login_step = 0;
        std::string line;
        while (io.next(line)) {
            // A password is not written down.
            const bool secret = login_step != 0 || line.starts_with("AUTH PLAIN ");
            m_transcript += (secret ? "<secret>" : line) + "\n";
            if (in_data) {
                if (line == ".") {
                    in_data = false;
                    m_delivered = true;
                    io.send("250 queued\r\n");
                }
            } else if (login_step == 1) {
                login_step = nc::util::base64_decode(line).value_or("") == user ? 2 : -1;
                io.send(login_step == 2 ? "334 UGFzc3dvcmQ6\r\n" : "535 no\r\n");
                login_step = login_step == 2 ? 2 : 0;
            } else if (login_step == 2) {
                login_step = 0;
                signed_in = nc::util::base64_decode(line).value_or("") == password;
                io.send(signed_in ? "235 welcome\r\n" : "535 no\r\n");
            } else if (line.starts_with("EHLO")) {
                std::string capabilities = "250-fake\r\n";
                if (m_tls == Tls::STARTTLS && io.ssl == nullptr && offer_starttls) {
                    capabilities += "250-STARTTLS\r\n";
                }
                // A sign-in is only offered where it would be protected, like a real relay.
                if (!auth_mechanisms.empty() && (m_tls == Tls::NONE || io.ssl != nullptr)) {
                    capabilities += "250-AUTH " + auth_mechanisms + "\r\n";
                }
                io.send(capabilities + "250 8BITMIME\r\n");
            } else if (line == "STARTTLS" && m_tls == Tls::STARTTLS && offer_starttls) {
                io.send("220 go ahead\r\n");
                if (!start_tls()) {
                    finish();
                    return;
                }
            } else if (line.starts_with("AUTH PLAIN ")) {
                signed_in = line.substr(11) == plain_login(user, password);
                io.send(signed_in ? "235 welcome\r\n" : "535 no\r\n");
            } else if (line == "AUTH LOGIN") {
                login_step = 1;
                io.send("334 VXNlcm5hbWU6\r\n");
            } else if (line.starts_with("MAIL") && !signed_in) {
                io.send("530 authentication required\r\n");
            } else if (line.starts_with("RCPT") && reject_recipient) {
                io.send("550 no such user\r\n");
            } else if (line.starts_with("MAIL") || line.starts_with("RCPT")) {
                io.send("250 ok\r\n");
            } else if (line == "DATA") {
                in_data = true;
                io.send("354 go on\r\n");
            } else if (line == "QUIT") {
                io.send("221 bye\r\n");
                finish();
                return;
            }
        }
        finish();
    }

    Tls m_tls;
    SSL_CTX* m_context{nullptr};
    int m_listen{-1};
    std::uint16_t m_port{0};
    std::string m_transcript{};
    bool m_delivered{false};
    std::thread m_thread{};
};

void test_smtp()
{
    {
        FakeSmtpServer server;
        const nc::mail::SmtpTransport smtp{"127.0.0.1", server.port(), "client.example.org"};
        const auto sent = smtp.send(
            nc::mail::Envelope{"a@example.org", {"b@example.org", "bcc@example.org"}},
            "Subject: x\r\n\r\n.starts with a dot\r\nend\r\n"
        );
        NC_CHECK(sent.has_value());
        const std::string& talk = server.transcript();
        NC_CHECK(talk.find("EHLO client.example.org\n") != std::string::npos);
        NC_CHECK(talk.find("MAIL FROM:<a@example.org>\n") != std::string::npos);
        NC_CHECK(talk.find("RCPT TO:<bcc@example.org>\n") != std::string::npos);
        NC_CHECK(talk.find("\n..starts with a dot\n") != std::string::npos); // dot-stuffed
    }
    {
        FakeSmtpServer server;
        server.reject_recipient = true;
        const nc::mail::SmtpTransport smtp{"127.0.0.1", server.port(), "client"};
        const auto sent = smtp.send(
            nc::mail::Envelope{"a@example.org", {"b@example.org"}},
            "Subject: x\r\n\r\nbody\r\n"
        );
        NC_CHECK(!sent.has_value());
        if (!sent) {
            NC_CHECK(sent.error().find("550") != std::string::npos);
        }
    }
    const nc::mail::SmtpTransport nowhere{"127.0.0.1", "1", "client"};
    NC_CHECK(!nowhere.send(nc::mail::Envelope{"a@example.org", {"b@example.org"}}, "x").has_value()
    );
    // An address that is not plain is refused before anything is sent.
    NC_CHECK(
        !nowhere
             .send(nc::mail::Envelope{"a@example.org", {"b@example.org>\r\nRCPT TO:<x@y.z"}}, "x")
             .has_value()
    );
}

void test_smtp_tls_and_auth()
{
    using nc::mail::SmtpSecurity;
    using nc::mail::SmtpSettings;
    const nc::mail::Envelope envelope{"a@example.org", {"b@example.org"}};
    const std::string message = "Subject: x\r\n\r\nbody\r\n";
    const Certificate relay{"DNS:localhost,IP:127.0.0.1"};
    const auto settings_for = [&](const FakeSmtpServer& server, SmtpSecurity security)
    {
        SmtpSettings settings;
        settings.host = "127.0.0.1";
        settings.port = server.port();
        settings.helo_name = "client";
        settings.security = security;
        settings.username = "mailer";
        settings.password = "s3cret";
        settings.ca_file = relay.cert;
        return settings;
    };
    const auto position = [](const std::string& text, const std::string& what)
    {
        return text.find(what);
    };

    // STARTTLS, then AUTH PLAIN: the sign-in comes after the switch to TLS, and EHLO is repeated.
    {
        FakeSmtpServer server{FakeSmtpServer::Tls::STARTTLS, &relay};
        server.auth_mechanisms = "PLAIN LOGIN";
        const nc::mail::SmtpTransport smtp{settings_for(server, SmtpSecurity::STARTTLS)};
        const auto sent = smtp.send(envelope, message);
        NC_CHECK(sent.has_value());
        NC_CHECK(server.delivered());
        const std::string& talk = server.transcript();
        NC_CHECK(position(talk, "STARTTLS\n") < position(talk, "<secret>\n"));
        NC_CHECK(position(talk, "<secret>\n") < position(talk, "MAIL FROM"));
        NC_CHECK(talk.find("EHLO client\n") != talk.rfind("EHLO client\n"));
        NC_CHECK(talk.find("s3cret") == std::string::npos);
    }
    // TLS from the first byte, and a relay that only knows AUTH LOGIN.
    {
        FakeSmtpServer server{FakeSmtpServer::Tls::IMPLICIT, &relay};
        server.auth_mechanisms = "LOGIN";
        const nc::mail::SmtpTransport smtp{settings_for(server, SmtpSecurity::TLS)};
        NC_CHECK(smtp.send(envelope, message).has_value());
        NC_CHECK(server.delivered());
        NC_CHECK(server.transcript().find("AUTH LOGIN\n") != std::string::npos);
    }
    // A wrong password is an authentication failure, and nothing is sent.
    {
        FakeSmtpServer server{FakeSmtpServer::Tls::STARTTLS, &relay};
        server.auth_mechanisms = "PLAIN";
        SmtpSettings settings = settings_for(server, SmtpSecurity::STARTTLS);
        settings.password = "wrong";
        const auto sent = nc::mail::SmtpTransport{std::move(settings)}.send(envelope, message);
        NC_CHECK(!sent.has_value());
        if (!sent) {
            NC_CHECK(sent.error().find("authentication") != std::string::npos);
        }
        NC_CHECK(!server.delivered());
        NC_CHECK(server.transcript().find("MAIL FROM") == std::string::npos);
    }
    // STARTTLS asked for but not offered: refused, the conversation goes no further.
    {
        FakeSmtpServer server{FakeSmtpServer::Tls::STARTTLS, &relay};
        server.offer_starttls = false;
        server.auth_mechanisms = "PLAIN";
        const auto sent = nc::mail::SmtpTransport{settings_for(server, SmtpSecurity::STARTTLS)}
                              .send(envelope, message);
        NC_CHECK(!sent.has_value());
        if (!sent) {
            NC_CHECK(sent.error().find("does not offer STARTTLS") != std::string::npos);
        }
        // The client did not even try: no STARTTLS command, and certainly no sign-in.
        NC_CHECK(server.transcript().find("STARTTLS\n") == std::string::npos);
        NC_CHECK(server.transcript().find("AUTH") == std::string::npos);
        NC_CHECK(server.transcript().find("MAIL FROM") == std::string::npos);
    }
    // A certificate that is not trusted, or that names someone else, gets no password.
    {
        const Certificate stranger{"DNS:localhost,IP:127.0.0.1"};
        FakeSmtpServer server{FakeSmtpServer::Tls::IMPLICIT, &stranger};
        server.auth_mechanisms = "PLAIN";
        const auto sent = nc::mail::SmtpTransport{settings_for(server, SmtpSecurity::TLS)}.send(
            envelope,
            message
        );
        NC_CHECK(!sent.has_value());
        if (!sent) {
            NC_CHECK(sent.error().find("not trusted") != std::string::npos);
        }
        NC_CHECK(!server.delivered());
    }
    {
        const Certificate elsewhere{"DNS:other.example"};
        FakeSmtpServer server{FakeSmtpServer::Tls::IMPLICIT, &elsewhere};
        server.auth_mechanisms = "PLAIN";
        SmtpSettings settings = settings_for(server, SmtpSecurity::TLS);
        settings.ca_file = elsewhere.cert; // trusted, but it does not name 127.0.0.1
        const auto sent = nc::mail::SmtpTransport{std::move(settings)}.send(envelope, message);
        NC_CHECK(!sent.has_value());
        NC_CHECK(!server.delivered());
    }
    // Without TLS a password goes to this machine and nowhere else; no credentials, no sign-in.
    {
        SmtpSettings settings;
        settings.host = "mail.example.org";
        settings.username = "mailer";
        settings.password = "s3cret";
        const auto sent = nc::mail::SmtpTransport{std::move(settings)}.send(envelope, message);
        NC_CHECK(!sent.has_value());
        if (!sent) {
            NC_CHECK(sent.error().find("without TLS") != std::string::npos);
        }
    }
    {
        FakeSmtpServer server;
        server.auth_mechanisms = "PLAIN";
        SmtpSettings settings = settings_for(server, SmtpSecurity::NONE);
        NC_CHECK(nc::mail::SmtpTransport{std::move(settings)}.send(envelope, message).has_value());
    }
    {
        FakeSmtpServer server;
        server.auth_mechanisms = "PLAIN";
        const nc::mail::SmtpTransport anonymous{"127.0.0.1", server.port(), "client"};
        const auto sent = anonymous.send(envelope, message);
        NC_CHECK(!sent.has_value());
        if (!sent) {
            NC_CHECK(sent.error().find("530") != std::string::npos);
        }
    }
}

void test_plugin()
{
    const std::string dir = temp_dir("plugin");
    nc::Kernel kernel{
        nc::Config::parse(
            "data_dir = " + dir +
            "\n[users]\npbkdf2_iterations = 3\n[mail]\nfrom_address = cloud@example.org\n"
        )
            .value()
    };
    kernel.get_logger().set_sink({});
    NC_CHECK(kernel.add_plugin_library("plugins/users/libusers.so").has_value());
    NC_CHECK(kernel.add_plugin_library("plugins/mail/libmail.so").has_value());
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{2});
    const std::string spool = dir + "/mail-spool";

    // Creating an account with an address sends the welcome mail (user plugin event -> mail
    // plugin).
    std::string out;
    ::setenv("OC_PASS", "admin password", 1);
    NC_CHECK_EQ(
        kernel.run_command(
            "user:add",
            {"admin", "--email=admin@example.org", "--display-name=Ada"},
            out
        ),
        0
    );
    ::unsetenv("OC_PASS");
    auto mails = files_with(spool, ".eml");
    NC_CHECK_EQ(mails.size(), std::size_t{1});
    if (!mails.empty()) {
        const std::string text = slurp(mails[0]);
        NC_CHECK(text.find("To: admin@example.org\r\n") != std::string::npos);
        NC_CHECK(text.find("Subject: Welcome to Nextcloud\r\n") != std::string::npos);
        NC_CHECK(text.find("From: Nextcloud <cloud@example.org>\r\n") != std::string::npos);
    }

    // The command line and the service.
    NC_CHECK_EQ(
        kernel.run_command("mail:send", {"someone@example.org", "Hi", "Body text"}, out),
        0
    );
    NC_CHECK_EQ(kernel.run_command("mail:send", {"not-an-address", "Hi", "Body text"}, out), 1);
    NC_CHECK_EQ(
        kernel.get_services()
            .call("mail.send", "to=a%40example.org&bcc=b%40example.org&subject=S&body=B")
            .get_status(),
        200
    );
    NC_CHECK_EQ(
        kernel.get_services().call("mail.send", "to=a%40example.org&subject=S").get_status(),
        400
    ); // no body
    NC_CHECK_EQ(kernel.get_services().call("mail.validate", "x@example.org").get_status(), 200);
    NC_CHECK_EQ(kernel.get_services().call("mail.validate", "x").get_status(), 400);
    NC_CHECK_EQ(files_with(spool, ".eml").size(), std::size_t{3});

    // The send API needs a signed-in user and puts that user's address in Reply-To.
    Request send{
        "POST",
        "/ocs/v2.php/apps/mail/api/v1/send",
        "",
        "to=friend%40example.org&subject=From+me&body=Hello",
        "",
        {},
        {}
    };
    NC_CHECK_EQ(kernel.handle(Request{send}).get_status(), 401);
    send.add_header("Authorization", "Basic " + nc::util::base64_encode("admin:admin password"));
    NC_CHECK_EQ(kernel.handle(Request{send}).get_status(), 200);
    bool found_reply_to = false;
    for (const auto& path: files_with(spool, ".eml")) {
        found_reply_to = found_reply_to ||
                         slurp(path).find("Reply-To: admin@example.org\r\n") != std::string::npos;
    }
    NC_CHECK(found_reply_to);

    // A share event for a user with an address sends a notification.
    const std::size_t before = files_with(spool, ".eml").size();
    ::setenv("OC_PASS", "friend password", 1);
    NC_CHECK_EQ(kernel.run_command("user:add", {"friend", "--email=friend@example.org"}, out), 0);
    ::unsetenv("OC_PASS");
    kernel.get_events().publish(
        "share.created",
        "type=0&owner=admin&share_with=friend&path=%2Fplan.txt"
    );
    NC_CHECK_EQ(files_with(spool, ".eml").size(), before + 2); // welcome + share notice
    kernel.get_events().publish(
        "share.created",
        "type=3&owner=admin&path=%2Fplan.txt"
    ); // link share: nobody to tell
    NC_CHECK_EQ(files_with(spool, ".eml").size(), before + 2);

    kernel.stop();
    std::filesystem::remove_all(dir);
}

void test_bad_config()
{
    nc::Kernel kernel{nc::Config::parse("[mail]\nmode = carrier-pigeon\n").value()};
    kernel.get_logger().set_sink({});
    NC_CHECK(kernel.add_plugin_library("plugins/mail/libmail.so").has_value());
    NC_CHECK(kernel.start().has_value());
    NC_CHECK_EQ(kernel.running_count(), std::size_t{0});
    NC_CHECK(kernel.plugins().front().get_state() == nc::PluginState::FAILED);
}

} // namespace

int main()
{
    test_headers_and_body();
    test_spool_and_null();
    test_smtp();
    test_smtp_tls_and_auth();
    test_plugin();
    test_bad_config();
    return NC_TEST_RESULT();
}
