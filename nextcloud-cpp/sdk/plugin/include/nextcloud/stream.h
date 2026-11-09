/**
 * @file stream.h
 * @brief Carries a streamed response body across the C ABI: `to_native` hands a stream out in an
 * `NcResponse`, `from_native` takes one in. Header only, shared by the runner and the plugins.
 */
#pragma once

#include "nextcloud/abi.h"
#include "nextcloud/http.h"

#include <cstddef>
#include <memory>

namespace nc::detail {

/// @brief True when the `NcResponse` the other side gave us is new enough to carry a stream.
[[nodiscard]] inline bool has_stream_fields(const NcResponse& out) noexcept
{
    return out.struct_size >= offsetof(NcResponse, stream_close) + sizeof(out.stream_close);
}

/// @brief Puts the response's stream (if it has one) into `out`. The heap holder is freed by
/// `stream_close`.
inline void stream_to_native(const http::Response& response, NcResponse* out)
{
    if (!has_stream_fields(*out)) {
        return;
    }
    out->stream = nullptr;
    if (!response.is_streamed()) {
        return;
    }
    out->stream_length = response.get_stream_length();
    out->stream = new std::shared_ptr<http::BodyReader>{response.get_stream()};
    out->stream_read = [](void* stream, char* buffer, std::size_t capacity) -> std::int64_t
    {
        try {
            return (**static_cast<std::shared_ptr<http::BodyReader>*>(stream))(buffer, capacity);
        } catch (...) {
            return -1;
        }
    };
    out->stream_close = [](void* stream)
    {
        delete static_cast<std::shared_ptr<http::BodyReader>*>(stream);
    };
}

/// @brief Takes the stream out of `out` (if there is one) and makes it the response's body. The
/// response owns the stream from here on and closes it when the last copy is gone.
inline void stream_from_native(const NcResponse& out, http::Response& response)
{
    if (!has_stream_fields(out) || out.stream == nullptr) {
        return;
    }

    struct Owner
    {
        Owner(void* stream_in, void (*close_in)(void*)) noexcept :
            stream{stream_in},
            close{close_in}
        {
        }

        Owner(const Owner&) = delete;
        Owner& operator=(const Owner&) = delete;

        ~Owner()
        {
            close(stream);
        }

        void* stream;
        void (*close)(void*);
    };

    const auto owner = std::make_shared<Owner>(out.stream, out.stream_close);
    const auto read = out.stream_read;
    response.set_stream(
        out.stream_length,
        [owner, read](char* buffer, std::size_t capacity)
        {
            return read(owner->stream, buffer, capacity);
        }
    );
}

} // namespace nc::detail
