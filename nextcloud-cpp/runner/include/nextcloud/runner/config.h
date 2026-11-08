#pragma once

#include "nextcloud/runner/error.h"

#include <map>
#include <string>
#include <string_view>

namespace nc {

/// @brief The runner's settings, the counterpart of Nextcloud's config/config.php.
///
/// A plain text file: `key = value` lines, `[section]` headers and `#` comments. Keys outside a
/// section belong to the runner (`data_dir`, `port`, `plugins`); keys under `[name]` belong to the
/// plugin `name` and are read by that plugin through `Host::config`.
class Config
{
public:
    Config() noexcept = default;

    explicit Config(std::map<std::string, std::string>&& values) noexcept :
        m_values{std::move(values)}
    {
    }

    [[nodiscard]] static Result<Config> parse(std::string_view text);
    [[nodiscard]] static Result<Config> load_file(const std::string& path);

    Config& add(std::string&& key, std::string&& value);
    void set(std::string&& key, std::string&& value);

    /// @brief Value of `section.key`, or nullptr when unset. The pointer stays valid until the
    /// value is replaced, which the runner never does after start-up.
    [[nodiscard]] const std::string*
    find(std::string_view section, std::string_view key) const noexcept;

    [[nodiscard]] std::string
    get_plugin(std::string_view section, std::string_view key, std::string_view fallback = {})
        const;
    [[nodiscard]] std::string get(std::string_view key, std::string_view fallback = {}) const;
    [[nodiscard]] long get_integer(std::string_view key, long fallback) const noexcept;

    [[nodiscard]] std::map<std::string, std::string>& get_values() noexcept
    {
        return m_values;
    }

    [[nodiscard]] const std::map<std::string, std::string>& get_values() const noexcept
    {
        return m_values;
    }

private:
    std::map<std::string, std::string> m_values{};
};

} // namespace nc
