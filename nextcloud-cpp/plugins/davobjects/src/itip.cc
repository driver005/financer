#include "itip.h"

#include "nextcloud/util/text.h"

#include <algorithm>
#include <cctype>

namespace nc::davobjects::itip {

namespace {

    /// `NAME;PARAM=a;PARAM2="b;c":value`
    struct Line
    {
        std::string name{};
        std::vector<std::string> params{};
        std::string value{};
    };

    Line parse_line(std::string_view text)
    {
        Line line;
        std::size_t at = 0;
        std::string current;
        bool quoted = false;
        bool in_value = false;
        bool first = true;
        const auto finish = [&]()
        {
            if (first) {
                line.name = nc::util::to_lower(current);
                first = false;
            } else {
                line.params.push_back(current);
            }
            current.clear();
        };
        for (; at < text.size(); ++at) {
            const char letter = text[at];
            if (letter == '"') {
                quoted = !quoted;
                current += letter;
            } else if (!quoted && letter == ';') {
                finish();
            } else if (!quoted && letter == ':') {
                finish();
                in_value = true;
                ++at;
                break;
            } else {
                current += letter;
            }
        }
        if (in_value) {
            line.value = std::string{text.substr(at)};
        }
        return line;
    }

    std::string param_value(const Line& line, std::string_view key)
    {
        for (const std::string& param: line.params) {
            const std::size_t equals = param.find('=');
            if (equals != std::string::npos &&
                nc::util::to_lower(param.substr(0, equals)) == nc::util::to_lower(key)) {
                std::string value = param.substr(equals + 1);
                if (value.size() >= 2 && value.front() == '"' && value.back() == '"') {
                    value = value.substr(1, value.size() - 2);
                }
                return value;
            }
        }
        return {};
    }

    std::string mailto(std::string_view value)
    {
        std::string address = nc::util::to_lower(nc::util::trim(value));
        if (nc::util::starts_with(address, "mailto:")) {
            address.erase(0, 7);
        }
        return address;
    }

    std::string upper(std::string_view text)
    {
        std::string out{text};
        std::ranges::transform(
            out,
            out.begin(),
            [](unsigned char letter)
            {
                return static_cast<char>(std::toupper(letter));
            }
        );
        return out;
    }

    std::vector<std::string> lines_of(std::string_view calendar)
    {
        std::vector<std::string> lines;
        for (const std::string& line: nc::util::split(unfold(calendar), '\n')) {
            std::string_view view{line};
            while (!view.empty() && (view.back() == '\r')) {
                view.remove_suffix(1);
            }
            lines.emplace_back(view);
        }
        while (!lines.empty() && lines.back().empty()) {
            lines.pop_back();
        }
        return lines;
    }

    std::string join(const std::vector<std::string>& lines)
    {
        std::string out;
        for (const std::string& line: lines) {
            out += line + "\r\n";
        }
        return out;
    }

    std::string escape_text(std::string_view text)
    {
        std::string out;
        for (const char letter: text) {
            if (letter == '\n') {
                out += "\\n";
            } else if (letter == '\r') {
                continue;
            } else {
                out += letter;
            }
        }
        return out;
    }

} // namespace

std::string unfold(std::string_view text)
{
    std::string out;
    for (std::size_t at = 0; at < text.size(); ++at) {
        if ((text[at] == '\r' && at + 2 < text.size() && text[at + 1] == '\n' &&
             (text[at + 2] == ' ' || text[at + 2] == '\t'))) {
            at += 2;
            continue;
        }
        if (text[at] == '\n' && at + 1 < text.size() &&
            (text[at + 1] == ' ' || text[at + 1] == '\t')) {
            ++at;
            continue;
        }
        out += text[at];
    }
    return out;
}

Event parse(std::string_view calendar)
{
    Event event;
    bool inside = false;
    for (const std::string& raw: lines_of(calendar)) {
        const std::string upper_line = upper(raw);
        if (upper_line == "BEGIN:VEVENT") {
            if (inside) {
                break;
            }
            inside = true;
            event.valid = true;
            continue;
        }
        if (upper_line == "END:VEVENT") {
            break;
        }
        if (!inside) {
            continue;
        }
        const Line line = parse_line(raw);
        if (line.name == "uid") {
            event.uid = line.value;
        } else if (line.name == "summary") {
            event.summary = line.value;
        } else if (line.name == "sequence") {
            event.sequence = line.value;
        } else if (line.name == "organizer") {
            event.organizer = mailto(line.value);
        } else if (line.name == "attendee") {
            std::string part = upper(param_value(line, "PARTSTAT"));
            event.attendees.push_back(
                Attendee{mailto(line.value), part.empty() ? "NEEDS-ACTION" : part}
            );
        }
    }
    return event;
}

std::string with_method(std::string_view calendar, std::string_view method)
{
    std::vector<std::string> out;
    bool placed = false;
    for (const std::string& line: lines_of(calendar)) {
        const std::string upper_line = upper(line);
        if (nc::util::starts_with(upper_line, "METHOD:")) {
            continue;
        }
        if (!placed && upper_line == "BEGIN:VEVENT") {
            out.push_back("METHOD:" + std::string{method});
            placed = true;
        }
        out.push_back(line);
    }
    return join(out);
}

std::string
set_partstat(std::string_view calendar, std::string_view email, std::string_view partstat)
{
    const std::string wanted = nc::util::to_lower(email);
    std::vector<std::string> out;
    for (const std::string& raw: lines_of(calendar)) {
        const Line line = parse_line(raw);
        if (line.name != "attendee" || mailto(line.value) != wanted) {
            out.push_back(raw);
            continue;
        }
        std::string rebuilt = "ATTENDEE;PARTSTAT=" + std::string{partstat};
        for (const std::string& param: line.params) {
            if (nc::util::to_lower(param.substr(0, param.find('='))) != "partstat") {
                rebuilt += ";" + param;
            }
        }
        out.push_back(rebuilt + ":" + line.value);
    }
    return join(out);
}

std::string reply_for(std::string_view calendar, std::string_view email, std::string_view partstat)
{
    const Event event = parse(calendar);
    std::string start;
    bool inside = false;
    for (const std::string& raw: lines_of(calendar)) {
        const std::string upper_line = upper(raw);
        if (upper_line == "BEGIN:VEVENT") {
            inside = true;
        } else if (upper_line == "END:VEVENT") {
            break;
        } else if (inside && (nc::util::starts_with(upper_line, "DTSTART"))) {
            start = raw;
        }
    }
    std::vector<std::string> out{
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Nextcloud C++//Scheduling//EN",
        "METHOD:REPLY",
        "BEGIN:VEVENT",
        "UID:" + event.uid,
        "DTSTAMP:19700101T000000Z",
        "SEQUENCE:" + event.sequence
    };
    if (!start.empty()) {
        out.push_back(start);
    }
    out.push_back("ORGANIZER:mailto:" + event.organizer);
    out.push_back("ATTENDEE;PARTSTAT=" + std::string{partstat} + ":mailto:" + std::string{email});
    if (!event.summary.empty()) {
        out.push_back("SUMMARY:" + escape_text(event.summary));
    }
    out.emplace_back("END:VEVENT");
    out.emplace_back("END:VCALENDAR");
    return join(out);
}

std::string uri_for(std::string_view uid)
{
    std::string out;
    for (const char letter: uid) {
        out += (std::isalnum(static_cast<unsigned char>(letter)) != 0 || letter == '-' ||
                letter == '_')
                   ? letter
                   : '_';
        if (out.size() >= 100) {
            break;
        }
    }
    return out.empty() ? std::string{"event"} : out;
}

} // namespace nc::davobjects::itip
