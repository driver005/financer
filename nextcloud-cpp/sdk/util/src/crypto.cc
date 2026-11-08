#include "nextcloud/util/crypto.h"

#include <algorithm>
#include <array>
#include <cstdio>
#include <stdexcept>

namespace nc::util {

namespace {

    constexpr std::array<std::uint32_t, 64> ROUND_CONSTANTS = {
        0x42'8a'2f'98, 0x71'37'44'91, 0xb5'c0'fb'cf, 0xe9'b5'db'a5, 0x39'56'c2'5b, 0x59'f1'11'f1,
        0x92'3f'82'a4, 0xab'1c'5e'd5, 0xd8'07'aa'98, 0x12'83'5b'01, 0x24'31'85'be, 0x55'0c'7d'c3,
        0x72'be'5d'74, 0x80'de'b1'fe, 0x9b'dc'06'a7, 0xc1'9b'f1'74, 0xe4'9b'69'c1, 0xef'be'47'86,
        0x0f'c1'9d'c6, 0x24'0c'a1'cc, 0x2d'e9'2c'6f, 0x4a'74'84'aa, 0x5c'b0'a9'dc, 0x76'f9'88'da,
        0x98'3e'51'52, 0xa8'31'c6'6d, 0xb0'03'27'c8, 0xbf'59'7f'c7, 0xc6'e0'0b'f3, 0xd5'a7'91'47,
        0x06'ca'63'51, 0x14'29'29'67, 0x27'b7'0a'85, 0x2e'1b'21'38, 0x4d'2c'6d'fc, 0x53'38'0d'13,
        0x65'0a'73'54, 0x76'6a'0a'bb, 0x81'c2'c9'2e, 0x92'72'2c'85, 0xa2'bf'e8'a1, 0xa8'1a'66'4b,
        0xc2'4b'8b'70, 0xc7'6c'51'a3, 0xd1'92'e8'19, 0xd6'99'06'24, 0xf4'0e'35'85, 0x10'6a'a0'70,
        0x19'a4'c1'16, 0x1e'37'6c'08, 0x27'48'77'4c, 0x34'b0'bc'b5, 0x39'1c'0c'b3, 0x4e'd8'aa'4a,
        0x5b'9c'ca'4f, 0x68'2e'6f'f3, 0x74'8f'82'ee, 0x78'a5'63'6f, 0x84'c8'78'14, 0x8c'c7'02'08,
        0x90'be'ff'fa, 0xa4'50'6c'eb, 0xbe'f9'a3'f7, 0xc6'71'78'f2
    };

    constexpr std::uint32_t rotate_right(std::uint32_t value, unsigned amount) noexcept
    {
        return (value >> amount) | (value << (32U - amount));
    }

    struct Sha256State
    {
        std::array<std::uint32_t, 8> hash = {
            0x6a'09'e6'67,
            0xbb'67'ae'85,
            0x3c'6e'f3'72,
            0xa5'4f'f5'3a,
            0x51'0e'52'7f,
            0x9b'05'68'8c,
            0x1f'83'd9'ab,
            0x5b'e0'cd'19
        };

        void block(const unsigned char* data) noexcept
        {
            std::array<std::uint32_t, 64> words{};
            for (std::size_t index = 0; index < 16; ++index) {
                words[index] = (std::uint32_t{data[index * 4]} << 24U) |
                               (std::uint32_t{data[index * 4 + 1]} << 16U) |
                               (std::uint32_t{data[index * 4 + 2]} << 8U) |
                               std::uint32_t{data[index * 4 + 3]};
            }
            for (std::size_t index = 16; index < 64; ++index) {
                const std::uint32_t s0 = rotate_right(words[index - 15], 7) ^
                                         rotate_right(words[index - 15], 18) ^
                                         (words[index - 15] >> 3U);
                const std::uint32_t s1 = rotate_right(words[index - 2], 17) ^
                                         rotate_right(words[index - 2], 19) ^
                                         (words[index - 2] >> 10U);
                words[index] = words[index - 16] + s0 + words[index - 7] + s1;
            }
            auto [a, b, c, d, e, f, g, h] = hash;
            for (std::size_t index = 0; index < 64; ++index) {
                const std::uint32_t big1 =
                    rotate_right(e, 6) ^ rotate_right(e, 11) ^ rotate_right(e, 25);
                const std::uint32_t choose = (e & f) ^ (~e & g);
                const std::uint32_t temp1 =
                    h + big1 + choose + ROUND_CONSTANTS[index] + words[index];
                const std::uint32_t big0 =
                    rotate_right(a, 2) ^ rotate_right(a, 13) ^ rotate_right(a, 22);
                const std::uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
                const std::uint32_t temp2 = big0 + majority;
                h = g;
                g = f;
                f = e;
                e = d + temp1;
                d = c;
                c = b;
                b = a;
                a = temp1 + temp2;
            }
            hash[0] += a;
            hash[1] += b;
            hash[2] += c;
            hash[3] += d;
            hash[4] += e;
            hash[5] += f;
            hash[6] += g;
            hash[7] += h;
        }
    };

} // namespace

std::string sha256(std::string_view data)
{
    Sha256State state;
    std::string padded(data);
    padded.push_back(static_cast<char>(0x80));
    while (padded.size() % 64 != 56) {
        padded.push_back('\0');
    }
    const std::uint64_t bit_length = std::uint64_t{data.size()} * 8U;
    for (int shift = 56; shift >= 0; shift -= 8) {
        padded.push_back(static_cast<char>((bit_length >> static_cast<unsigned>(shift)) & 0xFFU));
    }
    for (std::size_t offset = 0; offset < padded.size(); offset += 64) {
        state.block(reinterpret_cast<const unsigned char*>(padded.data()) + offset);
    }
    std::string out;
    for (const std::uint32_t word: state.hash) {
        for (int shift = 24; shift >= 0; shift -= 8) {
            out.push_back(static_cast<char>((word >> static_cast<unsigned>(shift)) & 0xFFU));
        }
    }
    return out;
}

std::string hmac_sha256(std::string_view key, std::string_view message)
{
    std::string block_key(key);
    if (block_key.size() > 64) {
        block_key = sha256(block_key);
    }
    block_key.resize(64, '\0');
    std::string inner(64, '\0');
    std::string outer(64, '\0');
    for (std::size_t index = 0; index < 64; ++index) {
        inner[index] = static_cast<char>(block_key[index] ^ 0x36);
        outer[index] = static_cast<char>(block_key[index] ^ 0x5c);
    }
    inner.append(message);
    outer.append(sha256(inner));
    return sha256(outer);
}

std::string
pbkdf2_sha256(std::string_view password, std::string_view salt, std::uint32_t iterations)
{
    std::string seed(salt);
    seed.append({'\0', '\0', '\0', '\x01'});
    std::string block = hmac_sha256(password, seed);
    std::string result = block;
    for (std::uint32_t round = 1; round < iterations; ++round) {
        block = hmac_sha256(password, block);
        for (std::size_t index = 0; index < result.size(); ++index) {
            result[index] = static_cast<char>(result[index] ^ block[index]);
        }
    }
    return result;
}

std::string sha1(std::string_view data)
{
    std::array<std::uint32_t, 5> hash =
        {0x67'45'23'01, 0xEF'CD'AB'89, 0x98'BA'DC'FE, 0x10'32'54'76, 0xC3'D2'E1'F0};
    std::string padded(data);
    padded.push_back(static_cast<char>(0x80));
    while (padded.size() % 64 != 56) {
        padded.push_back('\0');
    }
    const std::uint64_t bit_length = std::uint64_t{data.size()} * 8U;
    for (int shift = 56; shift >= 0; shift -= 8) {
        padded.push_back(static_cast<char>((bit_length >> static_cast<unsigned>(shift)) & 0xFFU));
    }
    const auto rotate_left = [](std::uint32_t value, unsigned amount)
    {
        return (value << amount) | (value >> (32U - amount));
    };
    for (std::size_t offset = 0; offset < padded.size(); offset += 64) {
        const auto* block = reinterpret_cast<const unsigned char*>(padded.data()) + offset;
        std::array<std::uint32_t, 80> words{};
        for (std::size_t index = 0; index < 16; ++index) {
            words[index] = (std::uint32_t{block[index * 4]} << 24U) |
                           (std::uint32_t{block[index * 4 + 1]} << 16U) |
                           (std::uint32_t{block[index * 4 + 2]} << 8U) |
                           std::uint32_t{block[index * 4 + 3]};
        }
        for (std::size_t index = 16; index < 80; ++index) {
            words[index] = rotate_left(
                words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16],
                1
            );
        }
        auto [a, b, c, d, e] = hash;
        for (std::size_t index = 0; index < 80; ++index) {
            std::uint32_t mix = 0;
            std::uint32_t constant = 0;
            if (index < 20) {
                mix = (b & c) | (~b & d);
                constant = 0x5A'82'79'99;
            } else if (index < 40) {
                mix = b ^ c ^ d;
                constant = 0x6E'D9'EB'A1;
            } else if (index < 60) {
                mix = (b & c) | (b & d) | (c & d);
                constant = 0x8F'1B'BC'DC;
            } else {
                mix = b ^ c ^ d;
                constant = 0xCA'62'C1'D6;
            }
            const std::uint32_t temp = rotate_left(a, 5) + mix + e + constant + words[index];
            e = d;
            d = c;
            c = rotate_left(b, 30);
            b = a;
            a = temp;
        }
        hash[0] += a;
        hash[1] += b;
        hash[2] += c;
        hash[3] += d;
        hash[4] += e;
    }
    std::string out;
    for (const std::uint32_t word: hash) {
        for (int shift = 24; shift >= 0; shift -= 8) {
            out.push_back(static_cast<char>((word >> static_cast<unsigned>(shift)) & 0xFFU));
        }
    }
    return out;
}

std::string hmac_sha1(std::string_view key, std::string_view message)
{
    std::string block_key(key);
    if (block_key.size() > 64) {
        block_key = sha1(block_key);
    }
    block_key.resize(64, '\0');
    std::string inner(64, '\0');
    std::string outer(64, '\0');
    for (std::size_t index = 0; index < 64; ++index) {
        inner[index] = static_cast<char>(block_key[index] ^ 0x36);
        outer[index] = static_cast<char>(block_key[index] ^ 0x5c);
    }
    inner.append(message);
    outer.append(sha1(inner));
    return sha1(outer);
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
    static constexpr std::string_view ALPHABET =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    for (std::size_t index = 0; index < bytes.size(); index += 3) {
        const std::size_t left = bytes.size() - index;
        std::uint32_t chunk = static_cast<unsigned char>(bytes[index]) << 16U;
        if (left > 1) {
            chunk |= static_cast<std::uint32_t>(static_cast<unsigned char>(bytes[index + 1])) << 8U;
        }
        if (left > 2) {
            chunk |= static_cast<unsigned char>(bytes[index + 2]);
        }
        out.push_back(ALPHABET[(chunk >> 18U) & 63U]);
        out.push_back(ALPHABET[(chunk >> 12U) & 63U]);
        out.push_back(left > 1 ? ALPHABET[(chunk >> 6U) & 63U] : '=');
        out.push_back(left > 2 ? ALPHABET[chunk & 63U] : '=');
    }
    return out;
}

std::optional<std::string> base64_decode(std::string_view text)
{
    std::string out;
    std::uint32_t buffer = 0;
    int bits = 0;
    for (const char letter: text) {
        if (letter == '=') {
            break;
        }
        std::uint32_t value = 0;
        if (letter >= 'A' && letter <= 'Z') {
            value = static_cast<std::uint32_t>(letter - 'A');
        } else if (letter >= 'a' && letter <= 'z') {
            value = static_cast<std::uint32_t>(letter - 'a' + 26);
        } else if (letter >= '0' && letter <= '9') {
            value = static_cast<std::uint32_t>(letter - '0' + 52);
        } else if (letter == '+') {
            value = 62;
        } else if (letter == '/') {
            value = 63;
        } else {
            return std::nullopt;
        }
        buffer = (buffer << 6U) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<char>((buffer >> static_cast<unsigned>(bits)) & 0xFFU));
        }
    }
    return out;
}

std::string random_hex(std::size_t count)
{
    std::FILE* source = std::fopen("/dev/urandom", "rb");
    if (source == nullptr) {
        throw std::runtime_error("cannot open /dev/urandom");
    }
    std::string bytes(count, '\0');
    const std::size_t got = std::fread(bytes.data(), 1, count, source);
    std::fclose(source);
    if (got != count) {
        throw std::runtime_error("short read from /dev/urandom");
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

} // namespace nc::util
