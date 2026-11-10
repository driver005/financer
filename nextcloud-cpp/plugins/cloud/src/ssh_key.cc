#include "ssh_key.h"

#include "nextcloud/util/crypto.h"

#include <cstdint>
#include <openssl/bio.h>
#include <openssl/bn.h>
#include <openssl/bytestring.h>
#include <openssl/ec.h>
#include <openssl/ec_key.h>
#include <openssl/ecdsa.h>
#include <openssl/evp.h>
#include <openssl/nid.h>
#include <openssl/pem.h>
#include <openssl/rsa.h>

namespace nc::cloud {

namespace {

    util::unexpected<std::string> failure(std::string message)
    {
        return util::unexpected<std::string>{std::move(message)};
    }

    struct KeyDeleter
    {
        void operator()(EVP_PKEY* key) const noexcept
        {
            EVP_PKEY_free(key);
        }
    };

    struct ContextDeleter
    {
        void operator()(EVP_MD_CTX* context) const noexcept
        {
            EVP_MD_CTX_free(context);
        }
    };

    struct SignatureDeleter
    {
        void operator()(ECDSA_SIG* signature) const noexcept
        {
            ECDSA_SIG_free(signature);
        }
    };

    struct BioDeleter
    {
        void operator()(BIO* bio) const noexcept
        {
            BIO_free(bio);
        }
    };

    void put_u32(std::string& out, std::uint32_t value)
    {
        for (int shift = 24; shift >= 0; shift -= 8) {
            out.push_back(static_cast<char>((value >> shift) & 0xFFU));
        }
    }

    void put_string(std::string& out, std::string_view text)
    {
        put_u32(out, static_cast<std::uint32_t>(text.size()));
        out.append(text);
    }

    /// An unsigned number as the SSH `mpint`: big endian, a zero byte in front when the top bit is
    /// set, nothing for zero.
    void put_mpint(std::string& out, const BIGNUM* number)
    {
        std::string bytes(static_cast<std::size_t>(BN_num_bytes(number)), '\0');
        BN_bn2bin(number, reinterpret_cast<std::uint8_t*>(bytes.data()));
        if (!bytes.empty() && (static_cast<unsigned char>(bytes.front()) & 0x80U) != 0) {
            bytes.insert(bytes.begin(), '\0');
        }
        put_string(out, bytes);
    }

    /// A reader over bytes in the SSH wire format.
    class Reader
    {
    public:
        explicit Reader(std::string_view data) noexcept :
            m_data{data}
        {
        }

        [[nodiscard]] bool u32(std::uint32_t& value) noexcept
        {
            if (m_data.size() < 4) {
                return false;
            }
            value = 0;
            for (int index = 0; index < 4; ++index) {
                value = (value << 8) | static_cast<unsigned char>(m_data[index]);
            }
            m_data.remove_prefix(4);
            return true;
        }

        [[nodiscard]] bool string(std::string_view& value) noexcept
        {
            std::uint32_t length = 0;
            if (!u32(length) || length > m_data.size()) {
                return false;
            }
            value = m_data.substr(0, length);
            m_data.remove_prefix(length);
            return true;
        }

        [[nodiscard]] bool skip(std::size_t count) noexcept
        {
            if (count > m_data.size()) {
                return false;
            }
            m_data.remove_prefix(count);
            return true;
        }

        [[nodiscard]] std::string_view rest() const noexcept
        {
            return m_data;
        }

    private:
        std::string_view m_data;
    };

    std::string_view between(std::string_view text, std::string_view begin, std::string_view end)
    {
        const std::size_t from = text.find(begin);
        if (from == std::string_view::npos) {
            return {};
        }
        const std::size_t to = text.find(end, from);
        if (to == std::string_view::npos) {
            return {};
        }
        return text.substr(from, to + end.size() - from);
    }

    /// The unencrypted OpenSSH key format, for the key types that carry their seed plainly
    /// (Ed25519).
    util::expected<std::unique_ptr<EVP_PKEY, KeyDeleter>, std::string>
    parse_openssh(std::string_view text)
    {
        std::string_view armored = between(
            text,
            "-----BEGIN OPENSSH PRIVATE KEY-----",
            "-----END OPENSSH PRIVATE KEY-----"
        );
        armored.remove_prefix(std::string_view{"-----BEGIN OPENSSH PRIVATE KEY-----"}.size());
        armored.remove_suffix(std::string_view{"-----END OPENSSH PRIVATE KEY-----"}.size());
        std::string body;
        for (const char letter: armored) {
            if (letter != '\n' && letter != '\r' && letter != ' ') {
                body.push_back(letter);
            }
        }
        const auto decoded = util::base64_decode(body);
        constexpr std::string_view MAGIC{"openssh-key-v1\0", 15};
        if (!decoded || decoded->compare(0, MAGIC.size(), MAGIC) != 0) {
            return failure("the private key file cannot be read");
        }
        Reader reader{std::string_view{*decoded}.substr(MAGIC.size())};
        std::string_view cipher;
        std::string_view kdf;
        std::string_view kdf_options;
        std::string_view public_key;
        std::string_view private_block;
        std::uint32_t count = 0;
        if (!reader.string(cipher) || !reader.string(kdf) || !reader.string(kdf_options) ||
            !reader.u32(count) || count != 1 || !reader.string(public_key) ||
            !reader.string(private_block)) {
            return failure("the private key file cannot be read");
        }
        if (cipher != "none") {
            return failure(
                "the private key is in the OpenSSH format with a passphrase; convert it with "
                "ssh-keygen -p -m PKCS8"
            );
        }
        Reader block{private_block};
        std::uint32_t check_one = 0;
        std::uint32_t check_two = 0;
        std::string_view type;
        std::string_view public_raw;
        std::string_view private_raw;
        if (!block.u32(check_one) || !block.u32(check_two) || check_one != check_two ||
            !block.string(type)) {
            return failure("the private key file cannot be read");
        }
        if (type != "ssh-ed25519") {
            return failure(
                "this OpenSSH private key type is not read; convert it with ssh-keygen -p -m PEM"
            );
        }
        if (!block.string(public_raw) || !block.string(private_raw) || public_raw.size() != 32 ||
            private_raw.size() != 64) {
            return failure("the private key file cannot be read");
        }
        std::unique_ptr<EVP_PKEY, KeyDeleter> key{EVP_PKEY_new_raw_private_key(
            EVP_PKEY_ED25519,
            nullptr,
            reinterpret_cast<const std::uint8_t*>(private_raw.data()),
            32
        )};
        if (!key) {
            return failure("the private key file cannot be read");
        }
        return key;
    }

    int password_callback(char* buffer, int size, int /*writing*/, void* user)
    {
        const auto& passphrase = *static_cast<const std::string*>(user);
        if (passphrase.empty() || passphrase.size() > static_cast<std::size_t>(size)) {
            return 0;
        }
        std::copy(passphrase.begin(), passphrase.end(), buffer);
        return static_cast<int>(passphrase.size());
    }

} // namespace

struct SshKey::Impl
{
    std::unique_ptr<EVP_PKEY, KeyDeleter> key;
};

SshKey::SshKey(std::unique_ptr<Impl> impl) noexcept :
    m_impl{std::move(impl)}
{
}

SshKey::SshKey(SshKey&&) noexcept = default;
SshKey& SshKey::operator=(SshKey&&) noexcept = default;
SshKey::~SshKey() = default;

util::expected<SshKey, std::string>
SshKey::parse(std::string_view text, const std::string& passphrase)
{
    auto impl = std::make_unique<Impl>();
    if (text.find("-----BEGIN OPENSSH PRIVATE KEY-----") != std::string_view::npos) {
        auto key = parse_openssh(text);
        if (!key) {
            return failure(key.error());
        }
        impl->key = std::move(*key);
    } else {
        std::unique_ptr<BIO, BioDeleter> bio{BIO_new_mem_buf(text.data(), text.size())};
        if (!bio) {
            return failure("cannot read the private key");
        }
        impl->key.reset(PEM_read_bio_PrivateKey(
            bio.get(),
            nullptr,
            &password_callback,
            const_cast<std::string*>(&passphrase)
        ));
        if (!impl->key) {
            return failure("the private key cannot be read (wrong passphrase or an unknown format)"
            );
        }
    }
    const int type = EVP_PKEY_id(impl->key.get());
    if (type != EVP_PKEY_RSA && type != EVP_PKEY_EC && type != EVP_PKEY_ED25519) {
        return failure("this private key type cannot be used to sign in");
    }
    if (type == EVP_PKEY_RSA) {
        if (RSA_bits(EVP_PKEY_get0_RSA(impl->key.get())) < 2'048) {
            return failure("an RSA key of less than 2048 bits is refused");
        }
    }
    if (type == EVP_PKEY_EC) {
        const int curve =
            EC_GROUP_get_curve_name(EC_KEY_get0_group(EVP_PKEY_get0_EC_KEY(impl->key.get())));
        if (curve != NID_X9_62_prime256v1 && curve != NID_secp384r1 && curve != NID_secp521r1) {
            return failure("this elliptic curve cannot be used to sign in");
        }
    }
    return SshKey{std::move(impl)};
}

std::string SshKey::public_blob() const
{
    EVP_PKEY* key = m_impl->key.get();
    std::string blob;
    switch (EVP_PKEY_id(key)) {
        case EVP_PKEY_RSA:
            {
                const RSA* rsa = EVP_PKEY_get0_RSA(key);
                put_string(blob, "ssh-rsa");
                put_mpint(blob, RSA_get0_e(rsa));
                put_mpint(blob, RSA_get0_n(rsa));
                break;
            }
        case EVP_PKEY_EC:
            {
                const EC_KEY* ec = EVP_PKEY_get0_EC_KEY(key);
                const EC_GROUP* group = EC_KEY_get0_group(ec);
                const int curve = EC_GROUP_get_curve_name(group);
                const char* name = curve == NID_X9_62_prime256v1 ? "nistp256"
                                   : curve == NID_secp384r1      ? "nistp384"
                                                                 : "nistp521";
                std::string point(133, '\0');
                const std::size_t length = EC_POINT_point2oct(
                    group,
                    EC_KEY_get0_public_key(ec),
                    POINT_CONVERSION_UNCOMPRESSED,
                    reinterpret_cast<std::uint8_t*>(point.data()),
                    point.size(),
                    nullptr
                );
                point.resize(length);
                put_string(blob, std::string{"ecdsa-sha2-"} + name);
                put_string(blob, name);
                put_string(blob, point);
                break;
            }
        default:
            {
                std::string raw(32, '\0');
                std::size_t length = raw.size();
                EVP_PKEY_get_raw_public_key(
                    key,
                    reinterpret_cast<std::uint8_t*>(raw.data()),
                    &length
                );
                put_string(blob, "ssh-ed25519");
                put_string(blob, raw);
                break;
            }
    }
    return blob;
}

util::expected<std::string, std::string> SshKey::sign(std::string_view data) const
{
    // What is signed: string session id, byte 50, string user, string service, string "publickey",
    // boolean, string algorithm, string public key. The server picked the algorithm.
    Reader reader{data};
    std::string_view ignored;
    std::string_view algorithm;
    if (!reader.string(ignored) || !reader.skip(1) || !reader.string(ignored) ||
        !reader.string(ignored) || !reader.string(ignored) || !reader.skip(1) ||
        !reader.string(algorithm)) {
        return failure("the data to sign is not an authentication request");
    }
    EVP_PKEY* key = m_impl->key.get();
    const EVP_MD* digest = nullptr;
    const int type = EVP_PKEY_id(key);
    if (type == EVP_PKEY_RSA) {
        digest = algorithm == "rsa-sha2-512"   ? EVP_sha512()
                 : algorithm == "rsa-sha2-256" ? EVP_sha256()
                 : algorithm == "ssh-rsa"      ? EVP_sha1()
                                               : nullptr;
    } else if (type == EVP_PKEY_EC) {
        const int curve = EC_GROUP_get_curve_name(EC_KEY_get0_group(EVP_PKEY_get0_EC_KEY(key)));
        if (curve == NID_X9_62_prime256v1 && algorithm == "ecdsa-sha2-nistp256") {
            digest = EVP_sha256();
        } else if (curve == NID_secp384r1 && algorithm == "ecdsa-sha2-nistp384") {
            digest = EVP_sha384();
        } else if (curve == NID_secp521r1 && algorithm == "ecdsa-sha2-nistp521") {
            digest = EVP_sha512();
        }
    }
    if (type != EVP_PKEY_ED25519 && digest == nullptr) {
        return failure("the server asked for an algorithm this key does not have");
    }
    if (type == EVP_PKEY_ED25519 && algorithm != "ssh-ed25519") {
        return failure("the server asked for an algorithm this key does not have");
    }
    std::unique_ptr<EVP_MD_CTX, ContextDeleter> context{EVP_MD_CTX_new()};
    if (!context || EVP_DigestSignInit(context.get(), nullptr, digest, nullptr, key) != 1) {
        return failure("cannot sign");
    }
    std::size_t length = 0;
    const auto* bytes = reinterpret_cast<const std::uint8_t*>(data.data());
    if (EVP_DigestSign(context.get(), nullptr, &length, bytes, data.size()) != 1) {
        return failure("cannot sign");
    }
    std::string raw(length, '\0');
    if (EVP_DigestSign(
            context.get(),
            reinterpret_cast<std::uint8_t*>(raw.data()),
            &length,
            bytes,
            data.size()
        ) != 1) {
        return failure("cannot sign");
    }
    raw.resize(length);
    std::string signature = raw;
    if (type == EVP_PKEY_EC) {
        // The wire format wants the two numbers, not the DER sequence.
        std::unique_ptr<ECDSA_SIG, SignatureDeleter> parsed{
            ECDSA_SIG_from_bytes(reinterpret_cast<const std::uint8_t*>(raw.data()), raw.size())
        };
        if (!parsed) {
            return failure("cannot sign");
        }
        signature.clear();
        put_mpint(signature, parsed->r);
        put_mpint(signature, parsed->s);
    }
    return signature;
}

} // namespace nc::cloud
