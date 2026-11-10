#include "nextcloud/util/aead.h"

#include <openssl/aead.h>
#include <stdexcept>

namespace nc::util {

namespace {

    constexpr std::size_t KEY_SIZE = 32;
    constexpr std::size_t NONCE_SIZE = 12;
    constexpr std::size_t TAG_SIZE = 16;

    void check_sizes(std::string_view key, std::string_view nonce)
    {
        if (key.size() != KEY_SIZE || nonce.size() != NONCE_SIZE) {
            throw std::invalid_argument("ChaCha20-Poly1305 needs a 32 byte key and a 12 byte nonce"
            );
        }
    }

    /// The key set up in BoringSSL's AEAD, released when it goes out of scope.
    class Aead
    {
    public:
        explicit Aead(std::string_view key)
        {
            EVP_AEAD_CTX_zero(&m_context);
            if (EVP_AEAD_CTX_init(
                    &m_context,
                    EVP_aead_chacha20_poly1305(),
                    reinterpret_cast<const unsigned char*>(key.data()),
                    key.size(),
                    TAG_SIZE,
                    nullptr
                ) != 1) {
                throw std::runtime_error("cannot set up ChaCha20-Poly1305");
            }
        }

        Aead(const Aead&) = delete;
        Aead& operator=(const Aead&) = delete;

        ~Aead()
        {
            EVP_AEAD_CTX_cleanup(&m_context);
        }

        [[nodiscard]] EVP_AEAD_CTX* get() noexcept
        {
            return &m_context;
        }

    private:
        EVP_AEAD_CTX m_context;
    };

    const unsigned char* bytes(std::string_view text) noexcept
    {
        return reinterpret_cast<const unsigned char*>(text.data());
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
    Aead aead{key};
    std::string sealed(plaintext.size() + TAG_SIZE, '\0');
    std::size_t length = 0;
    if (EVP_AEAD_CTX_seal(
            aead.get(),
            reinterpret_cast<unsigned char*>(sealed.data()),
            &length,
            sealed.size(),
            bytes(nonce),
            nonce.size(),
            bytes(plaintext),
            plaintext.size(),
            bytes(aad),
            aad.size()
        ) != 1) {
        throw std::runtime_error("ChaCha20-Poly1305 could not seal the data");
    }
    sealed.resize(length);
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
    if (sealed.size() < TAG_SIZE) {
        return std::nullopt;
    }
    Aead aead{key};
    std::string plaintext(sealed.size() - TAG_SIZE, '\0');
    std::size_t length = 0;
    // BoringSSL checks the tag (in constant time) before it hands out any plaintext.
    if (EVP_AEAD_CTX_open(
            aead.get(),
            reinterpret_cast<unsigned char*>(plaintext.data()),
            &length,
            plaintext.size(),
            bytes(nonce),
            nonce.size(),
            bytes(sealed),
            sealed.size(),
            bytes(aad),
            aad.size()
        ) != 1) {
        return std::nullopt;
    }
    plaintext.resize(length);
    return plaintext;
}

} // namespace nc::util
