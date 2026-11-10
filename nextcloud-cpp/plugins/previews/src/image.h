#pragma once

#include "nextcloud/util/expected.h"

#include <string>
#include <string_view>
#include <vector>

namespace nc::previews {

enum class Format
{
    PNG,
    JPEG,
    GIF,
    BMP,
    PNM,
    WEBP,
    SVG,
    TIFF,
    HEIF,
    UNKNOWN
};

/// @brief A decoded picture: 8 bit RGBA, row after row.
class Image
{
public:
    Image() noexcept = default;

    Image(int width, int height, std::vector<unsigned char>&& pixels) noexcept :
        m_width{width},
        m_height{height},
        m_pixels{std::move(pixels)}
    {
    }

    void set_width(int width) noexcept
    {
        m_width = width;
    }

    void set_height(int height) noexcept
    {
        m_height = height;
    }

    void set_pixels(std::vector<unsigned char>&& pixels) noexcept
    {
        m_pixels = std::move(pixels);
    }

    [[nodiscard]] int get_width() const noexcept
    {
        return m_width;
    }

    [[nodiscard]] int get_height() const noexcept
    {
        return m_height;
    }

    [[nodiscard]] std::vector<unsigned char>& get_pixels() noexcept
    {
        return m_pixels;
    }

    [[nodiscard]] const std::vector<unsigned char>& get_pixels() const noexcept
    {
        return m_pixels;
    }

private:
    int m_width{0};
    int m_height{0};
    std::vector<unsigned char> m_pixels{};
};

template<typename Value> using Result = util::expected<Value, std::string>;

/// @brief The format by the first bytes. Only these are ever handed to a decoder.
[[nodiscard]] Format sniff(std::string_view bytes) noexcept;

/// @brief Largest side and pixel count a picture may have before it is refused (a decompression
/// bomb is a small file that wants gigabytes).
inline constexpr int MAX_SIDE = 8'192;
inline constexpr long MAX_PIXELS = 40L * 1'000 * 1'000;

[[nodiscard]] Result<Image> decode(std::string_view bytes);
/// @brief The TIFF decoder alone (`decode` calls it for pictures that sniff as TIFF).
[[nodiscard]] Result<Image> decode_tiff(std::string_view bytes);
/// @brief The HEIC/HEIF decoder alone (HEVC pictures, as phones take them; `decode` calls it for
/// pictures that sniff as HEIF). Rotation and mirroring stored in the file are applied.
[[nodiscard]] Result<Image> decode_heif(std::string_view bytes);

/// @brief The picture scaled to fit inside `max_width` x `max_height`, keeping its shape; never
/// enlarged.
[[nodiscard]] Image fit(const Image& image, int max_width, int max_height);

[[nodiscard]] std::string encode_png(const Image& image);
[[nodiscard]] std::string encode_jpeg(const Image& image, int quality);

} // namespace nc::previews
