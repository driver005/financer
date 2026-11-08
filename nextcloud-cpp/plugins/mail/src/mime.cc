#include "mime.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"
#include "nextcloud/util/time.h"

#include <algorithm>

namespace nc::mail {

namespace {

    bool is_ascii(std::string_view text) noexcept
    {
        return std::ranges::all_of(
            text,
            [](char letter)
            {
                return static_cast<unsigned char>(letter) < 0x80;
            }
        );
    }

    bool has_line_break(std::string_view text) noexcept
    {
        return text.find_first_of("\r\n") != std::string_view::npos;
    }

    std::string mailbox(std::string_view name, std::string_view address)
    {
        if (name.empty()) {
            return std::string{address};
        }
        return encode_header_value(name) + " <" + std::string{address} + ">";
    }

    std::string address_list(const std::vector<std::string>& addresses)
    {
        std::string out;
        for (const std::string& address: addresses) {
            out += out.empty() ? "" : ", ";
            out += address;
        }
        return out;
    }

    std::string to_crlf(std::string_view text)
    {
        std::string out;
        for (std::size_t index = 0; index < text.size(); ++index) {
            if (text[index] == '\r' && index + 1 < text.size() && text[index + 1] == '\n') {
                continue;
            }
            if (text[index] == '\n') {
                out += "\r\n";
            } else {
                out.push_back(text[index]);
            }
        }
        return out;
    }

    std::string part(std::string_view type, std::string_view body)
    {
        return "Content-Type: " + std::string{type} +
               "; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" +
               wrap_base64(to_crlf(body));
    }

} // namespace

std::string encode_header_value(std::string_view value)
{
    if (is_ascii(value)) {
        return std::string{value};
    }
    std::string out;
    std::size_t start = 0;
    while (start < value.size()) {
        // Up to 45 bytes per word keeps each encoded word under the 75 character limit.
        std::size_t end = std::min(start + 45, value.size());
        while (end < value.size() && (static_cast<unsigned char>(value[end]) & 0xC0U) == 0x80U) {
            --end;
        }
        out += out.empty() ? "" : " ";
        out += "=?UTF-8?B?" + util::base64_encode(value.substr(start, end - start)) + "?=";
        start = end;
    }
    return out;
}

std::string wrap_base64(std::string_view bytes)
{
    const std::string encoded = util::base64_encode(bytes);
    std::string out;
    for (std::size_t offset = 0; offset < encoded.size(); offset += 76) {
        out += encoded.substr(offset, 76) + "\r\n";
    }
    return out;
}

Result<std::string> build_message(
    const MailMessage& message,
    std::chrono::system_clock::time_point now,
    std::string_view boundary_seed
)
{
    if (!util::is_valid_email(message.get_from())) {
        return util::unexpected<std::string>{"the sender address is not valid"};
    }
    if (message.get_to().empty()) {
        return util::unexpected<std::string>{"the mail has no recipient"};
    }
    for (const std::vector<std::string>* list:
         {&message.get_to(), &message.get_cc(), &message.get_bcc()}) {
        for (const std::string& address: *list) {
            if (!util::is_valid_email(address)) {
                return util::unexpected<std::string>{"not a valid address: " + address};
            }
        }
    }
    if (!message.get_reply_to().empty() && !util::is_valid_email(message.get_reply_to())) {
        return util::unexpected<std::string>{"the reply-to address is not valid"};
    }
    if (has_line_break(message.get_subject()) || has_line_break(message.get_from_name())) {
        return util::unexpected<std::string>{"a header value contains a line break"};
    }
    if (message.get_plain_body().empty() && message.get_html_body().empty()) {
        return util::unexpected<std::string>{"the mail has no body"};
    }

    const std::string_view from = message.get_from();
    const std::string domain{from.substr(from.find('@') + 1)};
    std::string out;
    out += "Date: " + util::mail_date(now) + "\r\n";
    out += "From: " + mailbox(message.get_from_name(), from) + "\r\n";
    out += "To: " + address_list(message.get_to()) + "\r\n";
    if (!message.get_cc().empty()) {
        out += "Cc: " + address_list(message.get_cc()) + "\r\n";
    }
    if (!message.get_reply_to().empty()) {
        out += "Reply-To: " + message.get_reply_to() + "\r\n";
    }
    out += "Subject: " + encode_header_value(message.get_subject()) + "\r\n";
    out += "Message-ID: <" + util::random_hex(12) + "@" + domain + ">\r\n";
    out += "MIME-Version: 1.0\r\n";

    const bool both = !message.get_plain_body().empty() && !message.get_html_body().empty();
    if (both) {
        const std::string boundary =
            "=_nc_" + (boundary_seed.empty() ? util::random_hex(12) : std::string{boundary_seed});
        out += "Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n\r\n";
        out += "--" + boundary + "\r\n" + part("text/plain", message.get_plain_body());
        out += "--" + boundary + "\r\n" + part("text/html", message.get_html_body());
        out += "--" + boundary + "--\r\n";
    } else if (!message.get_html_body().empty()) {
        out += part("text/html", message.get_html_body());
    } else {
        out += part("text/plain", message.get_plain_body());
    }
    return out;
}

} // namespace nc::mail
