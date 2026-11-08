#include "mime.h"
#include "nextcloud/runner/kernel.h"
#include "nextcloud/test.h"
#include "nextcloud/util/crypto.h"
#include "transport.h"

#include <arpa/inet.h>
#include <atomic>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <netinet/in.h>
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

/// A relay that accepts one mail and records the conversation.
class FakeSmtpServer
{
public:
    FakeSmtpServer()
    {
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
    }

    [[nodiscard]] std::string port() const
    {
        return std::to_string(m_port);
    }

    [[nodiscard]] const std::string& transcript() const
    {
        return m_transcript;
    }

    bool reject_recipient{false};

private:
    void reply(int client, const std::string& text) const
    {
        ::send(client, text.data(), text.size(), MSG_NOSIGNAL);
    }

    void serve()
    {
        const int client = ::accept(m_listen, nullptr, nullptr);
        if (client < 0) {
            return;
        }
        reply(client, "220 fake ESMTP\r\n");
        std::string pending;
        bool in_data = false;
        char chunk[4'096];
        while (true) {
            const ssize_t got = ::recv(client, chunk, sizeof(chunk), 0);
            if (got <= 0) {
                break;
            }
            pending.append(chunk, static_cast<std::size_t>(got));
            std::size_t newline;
            while ((newline = pending.find("\r\n")) != std::string::npos) {
                const std::string line = pending.substr(0, newline);
                pending.erase(0, newline + 2);
                m_transcript += line + "\n";
                if (in_data) {
                    if (line == ".") {
                        in_data = false;
                        reply(client, "250 queued\r\n");
                    }
                } else if (line.starts_with("EHLO")) {
                    reply(client, "250-fake\r\n250 8BITMIME\r\n");
                } else if (line.starts_with("RCPT") && reject_recipient) {
                    reply(client, "550 no such user\r\n");
                } else if (line.starts_with("MAIL") || line.starts_with("RCPT")) {
                    reply(client, "250 ok\r\n");
                } else if (line == "DATA") {
                    in_data = true;
                    reply(client, "354 go on\r\n");
                } else if (line == "QUIT") {
                    reply(client, "221 bye\r\n");
                    ::close(client);
                    return;
                }
            }
        }
        ::close(client);
    }

    int m_listen{-1};
    std::uint16_t m_port{0};
    std::string m_transcript{};
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
    test_plugin();
    test_bad_config();
    return NC_TEST_RESULT();
}
