#include "nextcloud/runner/config.h"

#include <cerrno>
#include <cstdlib>
#include <fstream>
#include <sstream>

#include "nextcloud/util/text.h"

namespace nc {

namespace {

std::string compose(std::string_view section, std::string_view key)
{
    return section.empty() ? std::string{key} : std::string{section} + "." + std::string{key};
}

}  // namespace

Result<Config> Config::parse(std::string_view text)
{
    Config config;
    std::string section;
    std::size_t line_number = 0;
    for (const std::string& raw : util::split(text, '\n')) {
        ++line_number;
        const std::string_view line = util::trim(raw);
        if (line.empty() || line.front() == '#') {
            continue;
        }
        if (line.front() == '[') {
            if (line.back() != ']') {
                return fail(ErrorCode::INVALID_ARGUMENT, "line " + std::to_string(line_number) + ": unclosed [section]");
            }
            section = std::string{util::trim(line.substr(1, line.size() - 2))};
            continue;
        }
        const std::size_t equals = line.find('=');
        if (equals == std::string_view::npos) {
            return fail(ErrorCode::INVALID_ARGUMENT, "line " + std::to_string(line_number) + ": expected key = value");
        }
        const std::string_view key = util::trim(line.substr(0, equals));
        if (key.empty()) {
            return fail(ErrorCode::INVALID_ARGUMENT, "line " + std::to_string(line_number) + ": empty key");
        }
        config.set(compose(section, key), std::string{util::trim(line.substr(equals + 1))});
    }
    return config;
}

Result<Config> Config::load_file(const std::string& path)
{
    std::ifstream stream{path};
    if (!stream) {
        return fail(ErrorCode::IO, "cannot read config file " + path);
    }
    std::ostringstream buffer;
    buffer << stream.rdbuf();
    return parse(buffer.str());
}

Config& Config::add(std::string&& key, std::string&& value)
{
    m_values.emplace(std::move(key), std::move(value));
    return *this;
}

void Config::set(std::string&& key, std::string&& value)
{
    m_values.insert_or_assign(std::move(key), std::move(value));
}

const std::string* Config::find(std::string_view section, std::string_view key) const noexcept
{
    const auto found = m_values.find(compose(section, key));
    return found == m_values.end() ? nullptr : &found->second;
}

std::string Config::get_plugin(std::string_view section, std::string_view key, std::string_view fallback) const
{
    const std::string* value = find(section, key);
    return value == nullptr ? std::string{fallback} : *value;
}

std::string Config::get(std::string_view key, std::string_view fallback) const
{
    return get_plugin({}, key, fallback);
}

long Config::get_integer(std::string_view key, long fallback) const noexcept
{
    const std::string* value = find({}, key);
    if (value == nullptr) {
        return fallback;
    }
    char* end = nullptr;
    errno = 0;
    const long parsed = std::strtol(value->c_str(), &end, 10);
    return (errno != 0 || end == value->c_str() || *end != '\0') ? fallback : parsed;
}

}  // namespace nc
