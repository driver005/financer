#define STB_IMAGE_IMPLEMENTATION
#define STBI_MAX_DIMENSIONS 8'192
#define STBI_ONLY_PNG
#define STBI_ONLY_JPEG
#define STBI_ONLY_GIF
#define STBI_ONLY_BMP
#define STBI_ONLY_PNM
#define STBI_NO_STDIO
#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STB_IMAGE_RESIZE_IMPLEMENTATION

#include "image.h"

#include <algorithm>
#include <cmath>
// The stb headers are third party code that is built with its own warning habits; ours do not apply
// to it.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Weverything"
#include <stb_image.h>
#include <stb_image_resize2.h>
#include <stb_image_write.h>
#pragma clang diagnostic pop

namespace nc::previews {

namespace {

    util::unexpected<std::string> failure(std::string message)
    {
        return util::unexpected<std::string>{std::move(message)};
    }

    void append(void* context, void* data, int size)
    {
        static_cast<std::string*>(context)->append(
            static_cast<const char*>(data),
            static_cast<std::size_t>(size)
        );
    }

} // namespace

Format sniff(std::string_view bytes) noexcept
{
    if (bytes.size() >= 8 && bytes.substr(0, 8) == std::string_view{"\x89PNG\r\n\x1a\n", 8}) {
        return Format::PNG;
    }
    if (bytes.size() >= 3 && static_cast<unsigned char>(bytes[0]) == 0xFF &&
        static_cast<unsigned char>(bytes[1]) == 0xD8 &&
        static_cast<unsigned char>(bytes[2]) == 0xFF) {
        return Format::JPEG;
    }
    if (bytes.size() >= 6 && (bytes.substr(0, 6) == "GIF87a" || bytes.substr(0, 6) == "GIF89a")) {
        return Format::GIF;
    }
    if (bytes.size() >= 2 && bytes.substr(0, 2) == "BM") {
        return Format::BMP;
    }
    // Netpbm: "P1".."P6" followed by white space (the plain and the binary kinds).
    if (bytes.size() >= 3 && bytes[0] == 'P' && bytes[1] >= '1' && bytes[1] <= '6' &&
        (bytes[2] == '\n' || bytes[2] == '\r' || bytes[2] == ' ' || bytes[2] == '\t')) {
        return Format::PNM;
    }
    return Format::UNKNOWN;
}

Result<Image> decode(std::string_view bytes)
{
    if (sniff(bytes) == Format::UNKNOWN) {
        return failure("not a PNG, JPEG, GIF, BMP or PNM picture");
    }
    int width = 0;
    int height = 0;
    int channels = 0;
    const auto* data = reinterpret_cast<const stbi_uc*>(bytes.data());
    if (stbi_info_from_memory(data, static_cast<int>(bytes.size()), &width, &height, &channels) ==
        0) {
        return failure("the picture is damaged");
    }
    // Look at the size before decoding: a tiny file can describe a gigantic picture.
    if (width <= 0 || height <= 0 || width > MAX_SIDE || height > MAX_SIDE ||
        static_cast<long>(width) * height > MAX_PIXELS) {
        return failure("the picture is too large to preview");
    }
    stbi_uc* pixels =
        stbi_load_from_memory(data, static_cast<int>(bytes.size()), &width, &height, &channels, 4);
    if (pixels == nullptr) {
        return failure("the picture is damaged");
    }
    std::vector<unsigned char> copy(
        pixels,
        pixels + static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4
    );
    stbi_image_free(pixels);
    return Image{width, height, std::move(copy)};
}

Image fit(const Image& image, int max_width, int max_height)
{
    if (image.get_width() <= 0 || image.get_height() <= 0 || max_width <= 0 || max_height <= 0 ||
        (image.get_width() <= max_width && image.get_height() <= max_height)) {
        return image;
    }
    const double scale = std::min(
        static_cast<double>(max_width) / image.get_width(),
        static_cast<double>(max_height) / image.get_height()
    );
    const int width = std::max(1, static_cast<int>(std::lround(image.get_width() * scale)));
    const int height = std::max(1, static_cast<int>(std::lround(image.get_height() * scale)));
    std::vector<unsigned char> pixels(
        static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4
    );
    stbir_resize_uint8_linear(
        image.get_pixels().data(),
        image.get_width(),
        image.get_height(),
        0,
        pixels.data(),
        width,
        height,
        0,
        STBIR_RGBA
    );
    return Image{width, height, std::move(pixels)};
}

std::string encode_png(const Image& image)
{
    std::string out;
    stbi_write_png_to_func(
        append,
        &out,
        image.get_width(),
        image.get_height(),
        4,
        image.get_pixels().data(),
        image.get_width() * 4
    );
    return out;
}

std::string encode_jpeg(const Image& image, int quality)
{
    std::string out;
    stbi_write_jpg_to_func(
        append,
        &out,
        image.get_width(),
        image.get_height(),
        4,
        image.get_pixels().data(),
        quality
    );
    return out;
}

} // namespace nc::previews
