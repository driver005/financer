#include "nextcloud/util/crypto.h"

#include <algorithm>
#include <cctype>
#include <openssl/base64.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/rand.h>
#include <openssl/sha.h>
#include <stdexcept>
#include <zlib.h>

namespace {

std::string hmac(const EVP_MD* digest, std::string_view key, std::string_view message)
{
    std::string out(EVP_MAX_MD_SIZE, '\0');
    unsigned size = 0;
    if (HMAC(
            digest,
            key.data(),
            key.size(),
            reinterpret_cast<const unsigned char*>(message.data()),
            message.size(),
            reinterpret_cast<unsigned char*>(out.data()),
            &size
        ) == nullptr) {
        throw std::runtime_error("HMAC failed");
    }
    out.resize(size);
    return out;
}

} // namespace

namespace nc::util {

std::string sha256(std::string_view data)
{
    std::string out(SHA256_DIGEST_LENGTH, '\0');
    SHA256(
        reinterpret_cast<const unsigned char*>(data.data()),
        data.size(),
        reinterpret_cast<unsigned char*>(out.data())
    );
    return out;
}

std::string hmac_sha256(std::string_view key, std::string_view message)
{
    return hmac(EVP_sha256(), key, message);
}

std::string
pbkdf2_sha256(std::string_view password, std::string_view salt, std::uint32_t iterations)
{
    std::string out(SHA256_DIGEST_LENGTH, '\0');
    if (PKCS5_PBKDF2_HMAC(
            password.data(),
            password.size(),
            reinterpret_cast<const unsigned char*>(salt.data()),
            salt.size(),
            static_cast<unsigned>(iterations),
            EVP_sha256(),
            out.size(),
            reinterpret_cast<unsigned char*>(out.data())
        ) != 1) {
        throw std::runtime_error("PBKDF2 failed");
    }
    return out;
}

std::string sha1(std::string_view data)
{
    std::string out(SHA_DIGEST_LENGTH, '\0');
    SHA1(
        reinterpret_cast<const unsigned char*>(data.data()),
        data.size(),
        reinterpret_cast<unsigned char*>(out.data())
    );
    return out;
}

std::string hmac_sha1(std::string_view key, std::string_view message)
{
    return hmac(EVP_sha1(), key, message);
}

std::string base32_encode(std::string_view bytes)
{
    static constexpr std::string_view ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    std::string out;
    std::uint32_t buffer = 0;
    int bits = 0;
    for (const char letter: bytes) {
        buffer = (buffer << 8U) | static_cast<unsigned char>(letter);
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out.push_back(ALPHABET[(buffer >> static_cast<unsigned>(bits)) & 31U]);
        }
    }
    if (bits > 0) {
        out.push_back(ALPHABET[(buffer << static_cast<unsigned>(5 - bits)) & 31U]);
    }
    return out;
}

std::optional<std::string> base32_decode(std::string_view text)
{
    std::string out;
    std::uint32_t buffer = 0;
    int bits = 0;
    for (const char raw: text) {
        if (raw == '=' || raw == ' ' || raw == '-') {
            continue;
        }
        const char letter = (raw >= 'a' && raw <= 'z') ? static_cast<char>(raw - 'a' + 'A') : raw;
        std::uint32_t value = 0;
        if (letter >= 'A' && letter <= 'Z') {
            value = static_cast<std::uint32_t>(letter - 'A');
        } else if (letter >= '2' && letter <= '7') {
            value = static_cast<std::uint32_t>(letter - '2' + 26);
        } else {
            return std::nullopt;
        }
        buffer = (buffer << 5U) | value;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<char>((buffer >> static_cast<unsigned>(bits)) & 0xFFU));
        }
    }
    return out;
}

std::string hotp(std::string_view secret, std::uint64_t counter, int digits)
{
    std::string message(8, '\0');
    for (int index = 7; index >= 0; --index) {
        message[static_cast<std::size_t>(index)] = static_cast<char>(counter & 0xFFU);
        counter >>= 8U;
    }
    const std::string mac = hmac_sha1(secret, message);
    const std::size_t offset = static_cast<unsigned char>(mac[19]) & 0x0FU;
    const std::uint32_t binary =
        ((static_cast<std::uint32_t>(static_cast<unsigned char>(mac[offset])) & 0x7FU) << 24U) |
        (static_cast<std::uint32_t>(static_cast<unsigned char>(mac[offset + 1])) << 16U) |
        (static_cast<std::uint32_t>(static_cast<unsigned char>(mac[offset + 2])) << 8U) |
        static_cast<std::uint32_t>(static_cast<unsigned char>(mac[offset + 3]));
    std::uint32_t modulus = 1;
    for (int index = 0; index < digits; ++index) {
        modulus *= 10;
    }
    std::string code = std::to_string(binary % modulus);
    return std::string(
               static_cast<std::size_t>(digits) -
                   std::min<std::size_t>(code.size(), static_cast<std::size_t>(digits)),
               '0'
           ) +
           code;
}

std::string to_hex(std::string_view bytes)
{
    static constexpr std::string_view DIGITS = "0123456789abcdef";
    std::string out;
    out.reserve(bytes.size() * 2);
    for (const char letter: bytes) {
        const auto byte = static_cast<unsigned char>(letter);
        out.push_back(DIGITS[byte >> 4U]);
        out.push_back(DIGITS[byte & 0x0FU]);
    }
    return out;
}

std::optional<std::string> from_hex(std::string_view hex)
{
    if (hex.size() % 2 != 0) {
        return std::nullopt;
    }
    const auto digit = [](char letter) -> int
    {
        if (letter >= '0' && letter <= '9') {
            return letter - '0';
        }
        if (letter >= 'a' && letter <= 'f') {
            return letter - 'a' + 10;
        }
        if (letter >= 'A' && letter <= 'F') {
            return letter - 'A' + 10;
        }
        return -1;
    };
    std::string out;
    for (std::size_t index = 0; index < hex.size(); index += 2) {
        const int high = digit(hex[index]);
        const int low = digit(hex[index + 1]);
        if (high < 0 || low < 0) {
            return std::nullopt;
        }
        out.push_back(static_cast<char>(high * 16 + low));
    }
    return out;
}

std::string base64_encode(std::string_view bytes)
{
    // EVP_EncodeBlock writes the standard alphabet with padding and no line breaks, and a final 0.
    std::string out(4 * ((bytes.size() + 2) / 3) + 1, '\0');
    const int length = EVP_EncodeBlock(
        reinterpret_cast<unsigned char*>(out.data()),
        reinterpret_cast<const unsigned char*>(bytes.data()),
        bytes.size()
    );
    out.resize(static_cast<std::size_t>(length));
    return out;
}

std::optional<std::string> base64_decode(std::string_view text)
{
    // Padding is optional here (BoringSSL wants it): up to two '=' at the end are dropped, and the
    // rest has to be the alphabet, and not 1 more than a multiple of 4.
    std::size_t padding = 0;
    while (padding < 2 && padding < text.size() && text[text.size() - 1 - padding] == '=') {
        ++padding;
    }
    std::string padded{text.substr(0, text.size() - padding)};
    if (padded.find('=') != std::string::npos || padded.size() % 4 == 1) {
        return std::nullopt;
    }
    padded.append((4 - padded.size() % 4) % 4, '=');
    std::string out(padded.size() / 4 * 3, '\0');
    std::size_t length = 0;
    if (!padded.empty() && EVP_DecodeBase64(
                               reinterpret_cast<unsigned char*>(out.data()),
                               &length,
                               out.size(),
                               reinterpret_cast<const unsigned char*>(padded.data()),
                               padded.size()
                           ) != 1) {
        return std::nullopt;
    }
    out.resize(length);
    return out;
}

std::string random_hex(std::size_t count)
{
    std::string bytes(count, '\0');
    if (count != 0 && RAND_bytes(reinterpret_cast<unsigned char*>(bytes.data()), count) != 1) {
        throw std::runtime_error("no random bytes");
    }
    return to_hex(bytes);
}

bool constant_time_equals(std::string_view left, std::string_view right) noexcept
{
    if (left.size() != right.size()) {
        return false;
    }
    unsigned char difference = 0;
    for (std::size_t index = 0; index < left.size(); ++index) {
        difference |= static_cast<unsigned char>(left[index] ^ right[index]);
    }
    return difference == 0;
}

struct Checksum::State
{
    const EVP_MD* digest{nullptr};
    std::unique_ptr<EVP_MD_CTX, decltype(&EVP_MD_CTX_free)> context{nullptr, &EVP_MD_CTX_free};
    uLong adler{0};
};

std::optional<Checksum> Checksum::create(std::string_view algorithm)
{
    std::string name;
    for (const char letter: algorithm) {
        name.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(letter))));
    }
    auto state = std::make_unique<State>();
    if (name == "ADLER32") {
        state->adler = adler32(0L, Z_NULL, 0);
        return Checksum{std::move(state)};
    }
    if (name == "SHA1") {
        state->digest = EVP_sha1();
    } else if (name == "SHA256") {
        state->digest = EVP_sha256();
    } else if (name == "MD5") {
        state->digest = EVP_md5();
    } else {
        return std::nullopt;
    }
    state->context.reset(EVP_MD_CTX_new());
    if (!state->context || EVP_DigestInit_ex(state->context.get(), state->digest, nullptr) != 1) {
        return std::nullopt;
    }
    return Checksum{std::move(state)};
}

Checksum::Checksum(std::unique_ptr<State> state) noexcept :
    m_state{std::move(state)}
{
}

Checksum::Checksum(Checksum&&) noexcept = default;
Checksum& Checksum::operator=(Checksum&&) noexcept = default;
Checksum::~Checksum() = default;

void Checksum::update(std::string_view data)
{
    if (m_state->digest == nullptr) {
        // zlib takes an unsigned int of bytes at a time.
        while (!data.empty()) {
            const std::size_t piece = std::min<std::size_t>(data.size(), 1U << 30U);
            m_state->adler = adler32(
                m_state->adler,
                reinterpret_cast<const Bytef*>(data.data()),
                static_cast<uInt>(piece)
            );
            data.remove_prefix(piece);
        }
        return;
    }
    EVP_DigestUpdate(m_state->context.get(), data.data(), data.size());
}

std::string Checksum::hex()
{
    if (m_state->digest == nullptr) {
        std::string out(4, '\0');
        for (int index = 0; index < 4; ++index) {
            out[static_cast<std::size_t>(index)] = static_cast<char>(
                (m_state->adler >> (24U - 8U * static_cast<unsigned>(index))) & 0xFFU
            );
        }
        return to_hex(out);
    }
    std::string out(EVP_MAX_MD_SIZE, '\0');
    unsigned size = 0;
    EVP_DigestFinal_ex(m_state->context.get(), reinterpret_cast<unsigned char*>(out.data()), &size);
    out.resize(size);
    return to_hex(out);
}

} // namespace nc::util
