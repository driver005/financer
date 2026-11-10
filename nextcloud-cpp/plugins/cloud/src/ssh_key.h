#pragma once

#include "nextcloud/util/expected.h"

#include <memory>
#include <string>
#include <string_view>

/// A private key for signing in to an SSH server, signed with BoringSSL: RSA, ECDSA (P-256, P-384,
/// P-521) and Ed25519. PEM and PKCS#8 files (also with a passphrase) are read; of the OpenSSH
/// format the unencrypted Ed25519 key is. (`ssh-keygen -p -m PEM` or `-m PKCS8` converts the rest.)
namespace nc::cloud {

class SshKey
{
public:
    SshKey(SshKey&&) noexcept;
    SshKey& operator=(SshKey&&) noexcept;
    SshKey(const SshKey&) = delete;
    SshKey& operator=(const SshKey&) = delete;
    ~SshKey();

    /// @brief Reads the key from `text` (the content of the file).
    [[nodiscard]] static util::expected<SshKey, std::string>
    parse(std::string_view text, const std::string& passphrase);

    /// @brief The public key in the SSH wire format (what follows the type in a `.pub` file, before
    /// base64).
    [[nodiscard]] std::string public_blob() const;

    /// @brief Signs what the client authentication asks to be signed (the data libssh2 hands over:
    /// it names the algorithm, which is picked by the server: ssh-rsa, rsa-sha2-256, rsa-sha2-512
    /// for RSA). Returns the signature as the client authentication carries it after the
    /// algorithm name: the bytes for RSA and Ed25519, the two numbers (mpint r, mpint s) for ECDSA.
    [[nodiscard]] util::expected<std::string, std::string> sign(std::string_view data) const;

private:
    struct Impl;
    explicit SshKey(std::unique_ptr<Impl> impl) noexcept;
    std::unique_ptr<Impl> m_impl;
};

} // namespace nc::cloud
