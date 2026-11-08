#include "nextcloud/util/crypto.h"

#include <array>
#include <cstdio>
#include <stdexcept>

namespace nc::util {

namespace {

constexpr std::array<std::uint32_t, 64> ROUND_CONSTANTS = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
};

constexpr std::uint32_t rotate_right(std::uint32_t value, unsigned amount) noexcept
{
    return (value >> amount) | (value << (32U - amount));
}

struct Sha256State
{
    std::array<std::uint32_t, 8> hash = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
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
                                     rotate_right(words[index - 15], 18) ^ (words[index - 15] >> 3U);
            const std::uint32_t s1 = rotate_right(words[index - 2], 17) ^
                                     rotate_right(words[index - 2], 19) ^ (words[index - 2] >> 10U);
            words[index] = words[index - 16] + s0 + words[index - 7] + s1;
        }
        auto [a, b, c, d, e, f, g, h] = hash;
        for (std::size_t index = 0; index < 64; ++index) {
            const std::uint32_t big1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^ rotate_right(e, 25);
            const std::uint32_t choose = (e & f) ^ (~e & g);
            const std::uint32_t temp1 = h + big1 + choose + ROUND_CONSTANTS[index] + words[index];
            const std::uint32_t big0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^ rotate_right(a, 22);
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

}  // namespace

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
    for (const std::uint32_t word : state.hash) {
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

std::string pbkdf2_sha256(std::string_view password, std::string_view salt, std::uint32_t iterations)
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

std::string to_hex(std::string_view bytes)
{
    static constexpr std::string_view DIGITS = "0123456789abcdef";
    std::string out;
    out.reserve(bytes.size() * 2);
    for (const char letter : bytes) {
        const auto byte = static_cast<unsigned char>(letter);
        out.push_back(DIGITS[byte >> 4U]);
        out.push_back(DIGITS[byte & 0x0FU]);
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
    for (const char letter : text) {
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

}  // namespace nc::util
