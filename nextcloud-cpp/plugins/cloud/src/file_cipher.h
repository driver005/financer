#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace nc::cloud {

/// @brief Encryption of file contents at rest, the counterpart of Nextcloud's server-side
/// encryption
/// (`apps/encryption`) in its simplest form: one server key, a different key per file.
///
/// A stored file is `"NCENC1" + salt(16) + nonce(12) + ChaCha20-Poly1305(content) + tag(16)`. The
/// file key is HMAC-SHA-256(server key, "nc-file-key" + user + salt), the user and the format tag
/// are authenticated as associated data, so a file moved to another account, or changed on disk,
/// does not decrypt. Files that do not start with the tag are plain files from before encryption
/// was switched on and are read as they are.
class FileCipher
{
public:
    /// @param server_key 32 bytes
    /// @param user the account the files belong to
    FileCipher(std::string&& server_key, std::string&& user);

    /// Bytes added to every encrypted file: tag, salt, nonce, authentication tag.
    static constexpr std::size_t OVERHEAD = 6 + 16 + 12 + 16;

    /// @brief Whether a file that begins with these bytes is an encrypted one (the first 6 are
    /// enough).
    [[nodiscard]] static bool has_tag(std::string_view prefix) noexcept;
    [[nodiscard]] static bool is_encrypted(std::string_view stored) noexcept;
    [[nodiscard]] std::string encrypt(std::string_view plain) const;
    /// @brief nullopt when the file is encrypted and does not verify; plain files are returned
    /// unchanged.
    [[nodiscard]] std::optional<std::string> decrypt(std::string_view stored) const;

    /// @brief Parses 64 hex digits into the 32 byte key; nullopt for anything else.
    [[nodiscard]] static std::optional<std::string> key_from_hex(std::string_view hex);

private:
    std::string m_server_key{};
    std::string m_user{};
};

} // namespace nc::cloud
