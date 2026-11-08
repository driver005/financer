#pragma once

#include "nextcloud/util/expected.h"

#include <string>
#include <utility>

namespace nc {

enum class ErrorCode
{
    INVALID_ARGUMENT,
    NOT_FOUND,
    ALREADY_EXISTS,
    IO,
    ABI_MISMATCH,
    DEPENDENCY,
    INTERNAL
};

/// @brief Why an operation failed. Every fallible runner call returns `std::expected<T, Error>`.
class Error
{
public:
    Error() noexcept = default;

    explicit Error(ErrorCode code) noexcept :
        m_code{code}
    {
    }

    Error(ErrorCode code, std::string&& message) noexcept :
        m_code{code},
        m_message{std::move(message)}
    {
    }

    void set_code(ErrorCode code) noexcept
    {
        m_code = code;
    }

    void set_message(std::string&& message) noexcept
    {
        m_message = std::move(message);
    }

    [[nodiscard]] ErrorCode& get_code() noexcept
    {
        return m_code;
    }

    [[nodiscard]] const ErrorCode& get_code() const noexcept
    {
        return m_code;
    }

    [[nodiscard]] std::string& get_message() noexcept
    {
        return m_message;
    }

    [[nodiscard]] const std::string& get_message() const noexcept
    {
        return m_message;
    }

private:
    ErrorCode m_code{ErrorCode::INTERNAL};
    std::string m_message{};
};

template<typename Value> using Result = util::expected<Value, Error>;

[[nodiscard]] inline util::unexpected<Error> fail(ErrorCode code, std::string&& message)
{
    return util::unexpected<Error>{Error{code, std::move(message)}};
}

} // namespace nc
