/**
 * @file expected.h
 * @brief `nc::util::expected<T, E>`: `std::expected` where the standard library has it, a small
 * compatible subset where it does not (clang 18 with libstdc++ 13 hides it, because clang reports
 * `__cpp_concepts` below the value libstdc++ asks for). Same names, same behaviour for what the runner
 * uses, so switching to the standard one later is a one-line change here.
 */
#pragma once

#include <version>

#if defined(__cpp_lib_expected) && __cpp_lib_expected >= 202202L

#    include <expected>

namespace nc::util {
using std::expected;
using std::unexpected;
}  // namespace nc::util

#else

#    include <optional>
#    include <stdexcept>
#    include <type_traits>
#    include <utility>
#    include <variant>

namespace nc::util {

template<typename E>
class unexpected
{
public:
    explicit unexpected(E error)
        : m_error{std::move(error)}
    {
    }

    [[nodiscard]] E& error() & noexcept { return m_error; }
    [[nodiscard]] const E& error() const& noexcept { return m_error; }
    [[nodiscard]] E&& error() && noexcept { return std::move(m_error); }

private:
    E m_error;
};

template<typename E>
unexpected(E) -> unexpected<E>;

class bad_expected_access : public std::runtime_error
{
public:
    bad_expected_access()
        : std::runtime_error{"bad expected access"}
    {
    }
};

template<typename T, typename E>
class expected
{
public:
    expected(const T& value)
        : m_data{std::in_place_index<0>, value}
    {
    }

    expected(T&& value)
        : m_data{std::in_place_index<0>, std::move(value)}
    {
    }

    template<typename G>
    expected(unexpected<G> error)
        : m_data{std::in_place_index<1>, E(std::move(error).error())}
    {
    }

    [[nodiscard]] bool has_value() const noexcept { return m_data.index() == 0; }
    explicit operator bool() const noexcept { return has_value(); }

    [[nodiscard]] T& value() &
    {
        if (!has_value()) {
            throw bad_expected_access{};
        }
        return std::get<0>(m_data);
    }

    [[nodiscard]] const T& value() const&
    {
        if (!has_value()) {
            throw bad_expected_access{};
        }
        return std::get<0>(m_data);
    }

    [[nodiscard]] T&& value() &&
    {
        if (!has_value()) {
            throw bad_expected_access{};
        }
        return std::get<0>(std::move(m_data));
    }

    [[nodiscard]] T& operator*() & noexcept { return *std::get_if<0>(&m_data); }
    [[nodiscard]] const T& operator*() const& noexcept { return *std::get_if<0>(&m_data); }
    [[nodiscard]] T&& operator*() && noexcept { return std::move(*std::get_if<0>(&m_data)); }
    [[nodiscard]] T* operator->() noexcept { return std::get_if<0>(&m_data); }
    [[nodiscard]] const T* operator->() const noexcept { return std::get_if<0>(&m_data); }

    [[nodiscard]] E& error() & noexcept { return *std::get_if<1>(&m_data); }
    [[nodiscard]] const E& error() const& noexcept { return *std::get_if<1>(&m_data); }

    template<typename U>
    [[nodiscard]] T value_or(U&& fallback) const&
    {
        return has_value() ? **this : static_cast<T>(std::forward<U>(fallback));
    }

private:
    std::variant<T, E> m_data;
};

template<typename E>
class expected<void, E>
{
public:
    expected() noexcept = default;

    template<typename G>
    expected(unexpected<G> error)
        : m_error{E(std::move(error).error())}
    {
    }

    [[nodiscard]] bool has_value() const noexcept { return !m_error.has_value(); }
    explicit operator bool() const noexcept { return has_value(); }
    void value() const
    {
        if (!has_value()) {
            throw bad_expected_access{};
        }
    }
    [[nodiscard]] E& error() & noexcept { return *m_error; }
    [[nodiscard]] const E& error() const& noexcept { return *m_error; }

private:
    std::optional<E> m_error{};
};

}  // namespace nc::util

#endif
