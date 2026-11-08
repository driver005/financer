#include "nextcloud/util/aead.h"

#include "nextcloud/util/crypto.h"

#include <array>
#include <cstdint>
#include <stdexcept>

namespace nc::util {

namespace {

    std::uint32_t load32(const unsigned char* bytes) noexcept
    {
        return std::uint32_t{bytes[0]} | (std::uint32_t{bytes[1]} << 8U) |
               (std::uint32_t{bytes[2]} << 16U) | (std::uint32_t{bytes[3]} << 24U);
    }

    void store32(unsigned char* bytes, std::uint32_t value) noexcept
    {
        bytes[0] = static_cast<unsigned char>(value & 0xFFU);
        bytes[1] = static_cast<unsigned char>((value >> 8U) & 0xFFU);
        bytes[2] = static_cast<unsigned char>((value >> 16U) & 0xFFU);
        bytes[3] = static_cast<unsigned char>((value >> 24U) & 0xFFU);
    }

    std::uint32_t rotate_left(std::uint32_t value, unsigned amount) noexcept
    {
        return (value << amount) | (value >> (32U - amount));
    }

    void quarter_round(std::array<std::uint32_t, 16>& s, int a, int b, int c, int d) noexcept
    {
        s[a] += s[b];
        s[d] = rotate_left(s[d] ^ s[a], 16);
        s[c] += s[d];
        s[b] = rotate_left(s[b] ^ s[c], 12);
        s[a] += s[b];
        s[d] = rotate_left(s[d] ^ s[a], 8);
        s[c] += s[d];
        s[b] = rotate_left(s[b] ^ s[c], 7);
    }

    /// One 64 byte ChaCha20 block for (key, counter, nonce).
    std::array<unsigned char, 64> chacha_block(
        const unsigned char* key,
        std::uint32_t counter,
        const unsigned char* nonce
    ) noexcept
    {
        std::array<std::uint32_t, 16> state =
            {0x61'70'78'65, 0x33'20'64'6e, 0x79'62'2d'32, 0x6b'20'65'74};
        for (int index = 0; index < 8; ++index) {
            state[4 + index] = load32(key + index * 4);
        }
        state[12] = counter;
        for (int index = 0; index < 3; ++index) {
            state[13 + index] = load32(nonce + index * 4);
        }
        std::array<std::uint32_t, 16> work = state;
        for (int round = 0; round < 10; ++round) {
            quarter_round(work, 0, 4, 8, 12);
            quarter_round(work, 1, 5, 9, 13);
            quarter_round(work, 2, 6, 10, 14);
            quarter_round(work, 3, 7, 11, 15);
            quarter_round(work, 0, 5, 10, 15);
            quarter_round(work, 1, 6, 11, 12);
            quarter_round(work, 2, 7, 8, 13);
            quarter_round(work, 3, 4, 9, 14);
        }
        std::array<unsigned char, 64> out{};
        for (int index = 0; index < 16; ++index) {
            store32(
                out.data() + index * 4,
                work[static_cast<std::size_t>(index)] + state[static_cast<std::size_t>(index)]
            );
        }
        return out;
    }

    /// XORs `data` with the ChaCha20 stream starting at block `counter`.
    std::string chacha_xor(
        const unsigned char* key,
        std::uint32_t counter,
        const unsigned char* nonce,
        std::string_view data
    )
    {
        std::string out(data.size(), '\0');
        for (std::size_t offset = 0; offset < data.size(); offset += 64, ++counter) {
            const auto block = chacha_block(key, counter, nonce);
            const std::size_t count = std::min<std::size_t>(64, data.size() - offset);
            for (std::size_t index = 0; index < count; ++index) {
                out[offset + index] = static_cast<char>(
                    static_cast<unsigned char>(data[offset + index]) ^ block[index]
                );
            }
        }
        return out;
    }

    /// Poly1305 (RFC 8439, section 2.5) with 26 bit limbs.
    std::array<unsigned char, 16> poly1305(const unsigned char* key, std::string_view message)
    {
        constexpr std::uint32_t MASK = 0x3'ff'ff'ff;
        const std::uint32_t r0 = load32(key + 0) & 0x3'ff'ff'ff;
        const std::uint32_t r1 = (load32(key + 3) >> 2U) & 0x3'ff'ff'03;
        const std::uint32_t r2 = (load32(key + 6) >> 4U) & 0x3'ff'c0'ff;
        const std::uint32_t r3 = (load32(key + 9) >> 6U) & 0x3'f0'3f'ff;
        const std::uint32_t r4 = (load32(key + 12) >> 8U) & 0x0'0f'ff'ff;
        const std::uint32_t s1 = r1 * 5, s2 = r2 * 5, s3 = r3 * 5, s4 = r4 * 5;
        std::uint32_t h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0;

        for (std::size_t offset = 0; offset < message.size(); offset += 16) {
            unsigned char block[16] = {};
            const std::size_t count = std::min<std::size_t>(16, message.size() - offset);
            for (std::size_t index = 0; index < count; ++index) {
                block[index] = static_cast<unsigned char>(message[offset + index]);
            }
            std::uint32_t high = 1U << 24U;
            if (count < 16) {
                block[count] = 1; // the padding bit goes in the data for a short block
                high = 0;
            }
            h0 += load32(block + 0) & MASK;
            h1 += (load32(block + 3) >> 2U) & MASK;
            h2 += (load32(block + 6) >> 4U) & MASK;
            h3 += (load32(block + 9) >> 6U) & MASK;
            h4 += (load32(block + 12) >> 8U) | high;

            const std::uint64_t d0 = std::uint64_t{h0} * r0 + std::uint64_t{h1} * s4 +
                                     std::uint64_t{h2} * s3 + std::uint64_t{h3} * s2 +
                                     std::uint64_t{h4} * s1;
            std::uint64_t d1 = std::uint64_t{h0} * r1 + std::uint64_t{h1} * r0 +
                               std::uint64_t{h2} * s4 + std::uint64_t{h3} * s3 +
                               std::uint64_t{h4} * s2;
            std::uint64_t d2 = std::uint64_t{h0} * r2 + std::uint64_t{h1} * r1 +
                               std::uint64_t{h2} * r0 + std::uint64_t{h3} * s4 +
                               std::uint64_t{h4} * s3;
            std::uint64_t d3 = std::uint64_t{h0} * r3 + std::uint64_t{h1} * r2 +
                               std::uint64_t{h2} * r1 + std::uint64_t{h3} * r0 +
                               std::uint64_t{h4} * s4;
            std::uint64_t d4 = std::uint64_t{h0} * r4 + std::uint64_t{h1} * r3 +
                               std::uint64_t{h2} * r2 + std::uint64_t{h3} * r1 +
                               std::uint64_t{h4} * r0;

            std::uint64_t carry = d0 >> 26U;
            h0 = static_cast<std::uint32_t>(d0) & MASK;
            d1 += carry;
            carry = d1 >> 26U;
            h1 = static_cast<std::uint32_t>(d1) & MASK;
            d2 += carry;
            carry = d2 >> 26U;
            h2 = static_cast<std::uint32_t>(d2) & MASK;
            d3 += carry;
            carry = d3 >> 26U;
            h3 = static_cast<std::uint32_t>(d3) & MASK;
            d4 += carry;
            carry = d4 >> 26U;
            h4 = static_cast<std::uint32_t>(d4) & MASK;
            h0 += static_cast<std::uint32_t>(carry) * 5;
            carry = h0 >> 26U;
            h0 &= MASK;
            h1 += static_cast<std::uint32_t>(carry);
        }

        // Fully reduce h modulo 2^130 - 5.
        std::uint32_t carry = h1 >> 26U;
        h1 &= MASK;
        h2 += carry;
        carry = h2 >> 26U;
        h2 &= MASK;
        h3 += carry;
        carry = h3 >> 26U;
        h3 &= MASK;
        h4 += carry;
        carry = h4 >> 26U;
        h4 &= MASK;
        h0 += carry * 5;
        carry = h0 >> 26U;
        h0 &= MASK;
        h1 += carry;

        std::uint32_t g0 = h0 + 5;
        carry = g0 >> 26U;
        g0 &= MASK;
        std::uint32_t g1 = h1 + carry;
        carry = g1 >> 26U;
        g1 &= MASK;
        std::uint32_t g2 = h2 + carry;
        carry = g2 >> 26U;
        g2 &= MASK;
        std::uint32_t g3 = h3 + carry;
        carry = g3 >> 26U;
        g3 &= MASK;
        const std::uint32_t g4 = h4 + carry - (1U << 26U);

        const std::uint32_t keep_h = (g4 >> 31U) - 1U; // all ones when h < p, so g is not used
        const std::uint32_t use_g = ~keep_h;
        h0 = (h0 & use_g) | (g0 & keep_h);
        h1 = (h1 & use_g) | (g1 & keep_h);
        h2 = (h2 & use_g) | (g2 & keep_h);
        h3 = (h3 & use_g) | (g3 & keep_h);
        h4 = (h4 & use_g) | ((g4 & MASK) & keep_h);

        // The tag is (h + s) mod 2^128, s being the second half of the key.
        const std::uint32_t t0 = h0 | (h1 << 26U);
        const std::uint32_t t1 = (h1 >> 6U) | (h2 << 20U);
        const std::uint32_t t2 = (h2 >> 12U) | (h3 << 14U);
        const std::uint32_t t3 = (h3 >> 18U) | (h4 << 8U);
        std::uint64_t f = std::uint64_t{t0} + load32(key + 16);
        std::array<unsigned char, 16> tag{};
        store32(tag.data() + 0, static_cast<std::uint32_t>(f));
        f = std::uint64_t{t1} + load32(key + 20) + (f >> 32U);
        store32(tag.data() + 4, static_cast<std::uint32_t>(f));
        f = std::uint64_t{t2} + load32(key + 24) + (f >> 32U);
        store32(tag.data() + 8, static_cast<std::uint32_t>(f));
        f = std::uint64_t{t3} + load32(key + 28) + (f >> 32U);
        store32(tag.data() + 12, static_cast<std::uint32_t>(f));
        return tag;
    }

    std::string mac_data(std::string_view aad, std::string_view ciphertext)
    {
        std::string data(aad);
        data.append((16 - aad.size() % 16) % 16, '\0');
        data.append(ciphertext);
        data.append((16 - ciphertext.size() % 16) % 16, '\0');
        for (const std::uint64_t length:
             {std::uint64_t{aad.size()}, std::uint64_t{ciphertext.size()}}) {
            for (int index = 0; index < 8; ++index) {
                data.push_back(
                    static_cast<char>((length >> (8U * static_cast<unsigned>(index))) & 0xFFU)
                );
            }
        }
        return data;
    }

    void check_sizes(std::string_view key, std::string_view nonce)
    {
        if (key.size() != 32 || nonce.size() != 12) {
            throw std::invalid_argument("ChaCha20-Poly1305 needs a 32 byte key and a 12 byte nonce"
            );
        }
    }

} // namespace

std::string chacha20_poly1305_seal(
    std::string_view key,
    std::string_view nonce,
    std::string_view aad,
    std::string_view plaintext
)
{
    check_sizes(key, nonce);
    const auto* k = reinterpret_cast<const unsigned char*>(key.data());
    const auto* n = reinterpret_cast<const unsigned char*>(nonce.data());
    const auto one_time =
        chacha_block(k, 0, n); // the first 32 bytes of block 0 are the Poly1305 key
    std::string sealed = chacha_xor(k, 1, n, plaintext);
    const auto tag = poly1305(one_time.data(), mac_data(aad, sealed));
    sealed.append(reinterpret_cast<const char*>(tag.data()), tag.size());
    return sealed;
}

std::optional<std::string> chacha20_poly1305_open(
    std::string_view key,
    std::string_view nonce,
    std::string_view aad,
    std::string_view sealed
)
{
    check_sizes(key, nonce);
    if (sealed.size() < 16) {
        return std::nullopt;
    }
    const auto* k = reinterpret_cast<const unsigned char*>(key.data());
    const auto* n = reinterpret_cast<const unsigned char*>(nonce.data());
    const std::string_view ciphertext = sealed.substr(0, sealed.size() - 16);
    const auto one_time = chacha_block(k, 0, n);
    const auto tag = poly1305(one_time.data(), mac_data(aad, ciphertext));
    if (!constant_time_equals(
            std::string_view{reinterpret_cast<const char*>(tag.data()), tag.size()},
            sealed.substr(sealed.size() - 16)
        )) {
        return std::nullopt;
    }
    return chacha_xor(k, 1, n, ciphertext);
}

} // namespace nc::util
