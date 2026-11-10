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
#include <cctype>
#include <cmath>
#include <cstdarg>
#include <cstdint>
#include <memory>
// The stb headers are third party code that is built with its own warning habits; ours do not apply
// to it.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Weverything"
#include <libheif/heif.h>
#include <lunasvg.h>
#include <stb_image.h>
#include <stb_image_resize2.h>
#include <stb_image_write.h>
#include <tiffio.h>
#include <webp/decode.h>
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
    // TIFF: "II*\0" / "MM\0*" (classic) or "II+\0" / "MM\0+" (BigTIFF).
    if (bytes.size() >= 8 &&
        ((bytes.substr(0, 2) == "II" && (bytes[2] == '*' || bytes[2] == '+') && bytes[3] == '\0') ||
         (bytes.substr(0, 2) == "MM" && bytes[2] == '\0' && (bytes[3] == '*' || bytes[3] == '+'))
        )) {
        return Format::TIFF;
    }
    // WebP: a RIFF container whose form type is "WEBP".
    if (bytes.size() >= 12 && bytes.substr(0, 4) == "RIFF" && bytes.substr(8, 4) == "WEBP") {
        return Format::WEBP;
    }
    // HEIC/HEIF: an ISO base media file, "....ftyp" and a brand of the HEVC kind (AVIF is another
    // codec that is not built in).
    if (bytes.size() >= 12 && bytes.substr(4, 4) == "ftyp") {
        const std::string_view brand = bytes.substr(8, 4);
        for (const std::string_view known:
             {"heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"}) {
            if (brand == known) {
                return Format::HEIF;
            }
        }
    }
    // SVG: text that starts (after an optional BOM, XML declaration, comments or doctype) with an
    // <svg> element.
    if (bytes.size() >= 5) {
        std::string_view head = bytes.substr(0, 2'048);
        if (head.starts_with("\xEF\xBB\xBF")) {
            head.remove_prefix(3);
        }
        while (!head.empty() && std::isspace(static_cast<unsigned char>(head.front())) != 0) {
            head.remove_prefix(1);
        }
        const bool xml_start = head.starts_with("<?xml") || head.starts_with("<!--") ||
                               head.starts_with("<!DOCTYPE") || head.starts_with("<svg");
        if (xml_start && head.find("<svg") != std::string_view::npos) {
            return Format::SVG;
        }
    }
    return Format::UNKNOWN;
}

namespace {

    /// A TIFF held in memory, read through libtiff's client I/O (no file is ever opened).
    struct MemoryFile
    {
        const char* data;
        std::size_t size;
        std::size_t position;
    };

    tmsize_t memory_read(thandle_t handle, void* buffer, tmsize_t count)
    {
        auto* file = static_cast<MemoryFile*>(handle);
        const std::size_t left = file->size - std::min(file->position, file->size);
        const std::size_t take = std::min<std::size_t>(static_cast<std::size_t>(count), left);
        std::copy_n(file->data + file->position, take, static_cast<char*>(buffer));
        file->position += take;
        return static_cast<tmsize_t>(take);
    }

    tmsize_t memory_write(thandle_t, void*, tmsize_t)
    {
        return -1; // read only
    }

    toff_t memory_seek(thandle_t handle, toff_t offset, int whence)
    {
        auto* file = static_cast<MemoryFile*>(handle);
        std::uint64_t target = 0;
        if (whence == SEEK_SET) {
            target = offset;
        } else if (whence == SEEK_CUR) {
            target = file->position + offset;
        } else {
            target = file->size + offset;
        }
        if (target > file->size) {
            return static_cast<toff_t>(-1);
        }
        file->position = static_cast<std::size_t>(target);
        return static_cast<toff_t>(target);
    }

    int memory_close(thandle_t)
    {
        return 0;
    }

    toff_t memory_size(thandle_t handle)
    {
        return static_cast<toff_t>(static_cast<MemoryFile*>(handle)->size);
    }

    int memory_map(thandle_t, void**, toff_t*)
    {
        return 0;
    }

    void memory_unmap(thandle_t, void*, toff_t) {}

    void quiet(const char*, const char*, va_list) {}

} // namespace

Result<Image> decode_tiff(std::string_view bytes)
{
    // libtiff reports damage through handlers that print by default; the caller gets a message.
    TIFFSetErrorHandler(quiet);
    TIFFSetWarningHandler(quiet);
    MemoryFile file{bytes.data(), bytes.size(), 0};
    TIFFOpenOptions* options = TIFFOpenOptionsAlloc();
    if (options == nullptr) {
        return failure("cannot read the picture");
    }
    // A small file must not be able to ask for gigabytes.
    TIFFOpenOptionsSetMaxSingleMemAlloc(options, 256 * 1'024 * 1'024);
    TIFF* tiff = TIFFClientOpenExt(
        "memory",
        "rm",
        &file,
        memory_read,
        memory_write,
        memory_seek,
        memory_close,
        memory_size,
        memory_map,
        memory_unmap,
        options
    );
    TIFFOpenOptionsFree(options);
    if (tiff == nullptr) {
        return failure("the picture is damaged");
    }
    std::uint32_t width = 0;
    std::uint32_t height = 0;
    if (TIFFGetField(tiff, TIFFTAG_IMAGEWIDTH, &width) != 1 ||
        TIFFGetField(tiff, TIFFTAG_IMAGELENGTH, &height) != 1 || width == 0 || height == 0 ||
        width > static_cast<std::uint32_t>(MAX_SIDE) ||
        height > static_cast<std::uint32_t>(MAX_SIDE) ||
        static_cast<long>(width) * static_cast<long>(height) > MAX_PIXELS) {
        TIFFClose(tiff);
        return failure("the picture is too large to preview");
    }
    std::vector<std::uint32_t> raster(static_cast<std::size_t>(width) * height);
    const int ok =
        TIFFReadRGBAImageOriented(tiff, width, height, raster.data(), ORIENTATION_TOPLEFT, 0);
    TIFFClose(tiff);
    if (ok == 0) {
        return failure("the picture is damaged or in an unsupported variant");
    }
    std::vector<unsigned char> pixels;
    pixels.reserve(raster.size() * 4);
    for (const std::uint32_t pixel: raster) {
        pixels.push_back(static_cast<unsigned char>(TIFFGetR(pixel)));
        pixels.push_back(static_cast<unsigned char>(TIFFGetG(pixel)));
        pixels.push_back(static_cast<unsigned char>(TIFFGetB(pixel)));
        pixels.push_back(static_cast<unsigned char>(TIFFGetA(pixel)));
    }
    return Image{static_cast<int>(width), static_cast<int>(height), std::move(pixels)};
}

Result<Image> decode_heif(std::string_view bytes)
{
    const std::unique_ptr<heif_context, decltype(&heif_context_free)> context{
        heif_context_alloc(),
        &heif_context_free
    };
    if (context == nullptr) {
        return failure("cannot read the picture");
    }
    // A small file must not be able to ask for gigabytes: the library refuses pictures and memory
    // blocks over these before it allocates them.
    if (heif_security_limits* limits = heif_context_get_security_limits(context.get());
        limits != nullptr) {
        limits->max_image_size_pixels = static_cast<std::uint64_t>(MAX_PIXELS);
        limits->max_memory_block_size = 256ULL * 1'024 * 1'024;
    }
    if (heif_context_read_from_memory_without_copy(
            context.get(),
            bytes.data(),
            bytes.size(),
            nullptr
        )
            .code != heif_error_Ok) {
        return failure("the picture is damaged");
    }
    heif_image_handle* raw_handle = nullptr;
    if (heif_context_get_primary_image_handle(context.get(), &raw_handle).code != heif_error_Ok) {
        return failure("the picture is damaged");
    }
    const std::unique_ptr<heif_image_handle, decltype(&heif_image_handle_release)> handle{
        raw_handle,
        &heif_image_handle_release
    };
    // Look at the size before decoding.
    const int stored_width = heif_image_handle_get_width(handle.get());
    const int stored_height = heif_image_handle_get_height(handle.get());
    if (stored_width <= 0 || stored_height <= 0 || stored_width > MAX_SIDE ||
        stored_height > MAX_SIDE || static_cast<long>(stored_width) * stored_height > MAX_PIXELS) {
        return failure("the picture is too large to preview");
    }
    const std::unique_ptr<heif_decoding_options, decltype(&heif_decoding_options_free)> options{
        heif_decoding_options_alloc(),
        &heif_decoding_options_free
    };
    if (options == nullptr) {
        return failure("cannot read the picture");
    }
    options->convert_hdr_to_8bit = 1;
    heif_image* raw_image = nullptr;
    if (heif_decode_image(
            handle.get(),
            &raw_image,
            heif_colorspace_RGB,
            heif_chroma_interleaved_RGBA,
            options.get()
        )
            .code != heif_error_Ok) {
        return failure("the picture is damaged or in an unsupported variant");
    }
    const std::unique_ptr<heif_image, decltype(&heif_image_release)> image{
        raw_image,
        &heif_image_release
    };
    int stride = 0;
    const std::uint8_t* plane =
        heif_image_get_plane_readonly(image.get(), heif_channel_interleaved, &stride);
    const int width = heif_image_get_width(image.get(), heif_channel_interleaved);
    const int height = heif_image_get_height(image.get(), heif_channel_interleaved);
    if (plane == nullptr || width <= 0 || height <= 0 || width > MAX_SIDE || height > MAX_SIDE ||
        static_cast<long>(width) * height > MAX_PIXELS || stride < width * 4) {
        return failure("the picture is damaged or too large to preview");
    }
    std::vector<unsigned char> pixels(static_cast<std::size_t>(width) * height * 4);
    for (int row = 0; row < height; ++row) {
        std::copy_n(
            plane + static_cast<std::size_t>(row) * static_cast<std::size_t>(stride),
            static_cast<std::size_t>(width) * 4,
            pixels.begin() + static_cast<std::ptrdiff_t>(row) * width * 4
        );
    }
    return Image{width, height, std::move(pixels)};
}

Result<Image> decode(std::string_view bytes)
{
    const Format format = sniff(bytes);
    if (format == Format::UNKNOWN) {
        return failure("not a picture format that can be previewed");
    }
    if (format == Format::SVG) {
        // A vector picture has no pixels of its own: it is drawn at its own size, at most 2048 on a
        // side (a preview is never bigger). Scripts, external files and links are not followed.
        if (bytes.size() > 5U * 1'024U * 1'024U) {
            return failure("the picture is too large to preview");
        }
        const auto document = lunasvg::Document::loadFromData(std::string{bytes});
        if (document == nullptr || document->width() <= 0 || document->height() <= 0) {
            return failure("the picture is damaged");
        }
        constexpr double SVG_SIDE = 2'048;
        const double scale =
            std::min({1.0, SVG_SIDE / document->width(), SVG_SIDE / document->height()});
        const auto width =
            static_cast<std::uint32_t>(std::max(1.0, std::round(document->width() * scale)));
        const auto height =
            static_cast<std::uint32_t>(std::max(1.0, std::round(document->height() * scale)));
        lunasvg::Bitmap bitmap = document->renderToBitmap(width, height);
        if (!bitmap.valid()) {
            return failure("the picture could not be drawn");
        }
        bitmap.convertToRGBA();
        std::vector<unsigned char> pixels(static_cast<std::size_t>(width) * height * 4);
        for (std::uint32_t row = 0; row < height; ++row) {
            std::copy_n(
                bitmap.data() + static_cast<std::size_t>(row) * bitmap.stride(),
                static_cast<std::size_t>(width) * 4,
                pixels.begin() + static_cast<std::ptrdiff_t>(row) * width * 4
            );
        }
        return Image{static_cast<int>(width), static_cast<int>(height), std::move(pixels)};
    }
    if (format == Format::TIFF) {
        return decode_tiff(bytes);
    }
    if (format == Format::HEIF) {
        return decode_heif(bytes);
    }
    if (format == Format::WEBP) {
        int width = 0;
        int height = 0;
        const auto* data = reinterpret_cast<const std::uint8_t*>(bytes.data());
        if (WebPGetInfo(data, bytes.size(), &width, &height) == 0) {
            return failure("the picture is damaged");
        }
        if (width <= 0 || height <= 0 || width > MAX_SIDE || height > MAX_SIDE ||
            static_cast<long>(width) * height > MAX_PIXELS) {
            return failure("the picture is too large to preview");
        }
        std::uint8_t* pixels = WebPDecodeRGBA(data, bytes.size(), &width, &height);
        if (pixels == nullptr) {
            return failure("the picture is damaged");
        }
        std::vector<unsigned char> copy(
            pixels,
            pixels + static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4
        );
        WebPFree(pixels);
        return Image{width, height, std::move(copy)};
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
