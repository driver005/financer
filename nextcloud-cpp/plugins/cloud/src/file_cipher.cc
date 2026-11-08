#include "file_cipher.h"

#include "nextcloud/util/aead.h"
#include "nextcloud/util/crypto.h"

namespace nc::cloud {

namespace {

    constexpr std::string_view TAG = "NCENC1";

} // namespace

FileCipher::FileCipher(std::string&& server_key, std::string&& user) :
    m_server_key{std::move(server_key)},
    m_user{std::move(user)}
{
}

bool FileCipher::has_tag(std::string_view prefix) noexcept
{
    return prefix.substr(0, TAG.size()) == TAG;
}

bool FileCipher::is_encrypted(std::string_view stored) noexcept
{
    return stored.size() >= OVERHEAD && has_tag(stored);
}

std::string FileCipher::encrypt(std::string_view plain) const
{
    const std::string salt = util::from_hex(util::random_hex(16)).value();
    const std::string nonce = util::from_hex(util::random_hex(12)).value();
    const std::string key = util::hmac_sha256(m_server_key, "nc-file-key" + m_user + salt);
    std::string out(TAG);
    out += salt + nonce;
    out += util::chacha20_poly1305_seal(key, nonce, std::string(TAG) + m_user, plain);
    return out;
}

std::optional<std::string> FileCipher::decrypt(std::string_view stored) const
{
    if (!is_encrypted(stored)) {
        return std::string{stored};
    }
    const std::string_view salt = stored.substr(TAG.size(), 16);
    const std::string_view nonce = stored.substr(TAG.size() + 16, 12);
    const std::string key =
        util::hmac_sha256(m_server_key, "nc-file-key" + m_user + std::string{salt});
    return util::chacha20_poly1305_open(
        key,
        nonce,
        std::string(TAG) + m_user,
        stored.substr(TAG.size() + 28)
    );
}

std::optional<std::string> FileCipher::key_from_hex(std::string_view hex)
{
    if (hex.size() != 64) {
        return std::nullopt;
    }
    return util::from_hex(hex);
}

} // namespace nc::cloud
