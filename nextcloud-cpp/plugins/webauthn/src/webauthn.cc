#include "webauthn.h"

#include "nextcloud/util/crypto.h"
#include "nextcloud/util/json.h"

#include <algorithm>
#include <memory>
#include <openssl/bn.h>
#include <openssl/bytestring.h>
#include <openssl/ec.h>
#include <openssl/ec_key.h>
#include <openssl/evp.h>
#include <openssl/mem.h>
#include <openssl/nid.h>
#include <openssl/rsa.h>

namespace nc::webauthn {

namespace {

    util::unexpected<std::string> failure(std::string message)
    {
        return util::unexpected<std::string>{std::move(message)};
    }

    constexpr std::size_t MAX_CBOR = 16U * 1'024U;
    constexpr std::uint8_t FLAG_USER_PRESENT = 0x01;
    constexpr std::uint8_t FLAG_USER_VERIFIED = 0x04;
    constexpr std::uint8_t FLAG_BACKUP_ELIGIBLE = 0x08;
    constexpr std::uint8_t FLAG_BACKED_UP = 0x10;
    constexpr std::uint8_t FLAG_ATTESTED = 0x40;
    constexpr std::uint8_t FLAG_EXTENSIONS = 0x80;

    constexpr std::int32_t ES256 = -7;
    constexpr std::int32_t RS256 = -257;
    constexpr std::int32_t EDDSA = -8;

    struct KeyDeleter
    {
        void operator()(EVP_PKEY* key) const noexcept
        {
            EVP_PKEY_free(key);
        }
    };

    using Key = std::unique_ptr<EVP_PKEY, KeyDeleter>;

    struct ContextDeleter
    {
        void operator()(EVP_MD_CTX* context) const noexcept
        {
            EVP_MD_CTX_free(context);
        }
    };

    std::string sha256_of(std::string_view data)
    {
        return util::sha256(data);
    }

    /// The CBOR subset WebAuthn uses (RFC 8949): integers, byte and text strings, arrays, maps.
    /// Definite lengths only, no tags and no floats; depth, size and item count are limited.
    /// Map keys are kept as text (an integer key as its decimal digits).
    struct Cbor
    {
        enum class Kind
        {
            INTEGER,
            BYTES,
            TEXT,
            ARRAY,
            MAP,
            SIMPLE
        };
        Kind kind{Kind::SIMPLE};
        std::int64_t integer{0};
        std::string text{}; // bytes or text
        std::vector<Cbor> items{};
        std::vector<std::pair<std::string, Cbor>> members{};

        [[nodiscard]] const Cbor* get(std::string_view key) const
        {
            for (const auto& [name, value]: members) {
                if (name == key) {
                    return &value;
                }
            }
            return nullptr;
        }

        [[nodiscard]] bool is(Kind wanted) const noexcept
        {
            return kind == wanted;
        }
    };

    class CborReader
    {
    public:
        explicit CborReader(std::string_view data) noexcept :
            m_data{data}
        {
        }

        [[nodiscard]] Result<Cbor> read(int depth = 0)
        {
            if (depth > 8 || ++m_items > 1'024 || m_position >= m_data.size()) {
                return failure("the CBOR data is too deep, too long or cut off");
            }
            const auto first = static_cast<unsigned char>(m_data[m_position++]);
            const unsigned major = first >> 5U;
            const unsigned info = first & 0x1FU;
            if (major == 7) {
                // false, true, null: nothing else (no floats, no indefinite breaks).
                if (info >= 20 && info <= 22) {
                    return Cbor{};
                }
                return failure("the CBOR data has a value that is not accepted");
            }
            std::uint64_t argument = info;
            if (info >= 24) {
                if (info > 27) {
                    return failure("the CBOR data uses an indefinite length");
                }
                const unsigned width = 1U << (info - 24U);
                if (m_data.size() - m_position < width) {
                    return failure("the CBOR data is cut off");
                }
                argument = 0;
                for (unsigned index = 0; index < width; ++index) {
                    argument = (argument << 8U) | static_cast<unsigned char>(m_data[m_position++]);
                }
            }
            Cbor out;
            switch (major) {
                case 0:
                case 1:
                    if (argument > static_cast<std::uint64_t>(INT64_MAX)) {
                        return failure("the CBOR integer is too large");
                    }
                    out.kind = Cbor::Kind::INTEGER;
                    out.integer = major == 0 ? static_cast<std::int64_t>(argument)
                                             : -1 - static_cast<std::int64_t>(argument);
                    return out;
                case 2:
                case 3:
                    if (argument > m_data.size() - m_position) {
                        return failure("the CBOR data is cut off");
                    }
                    out.kind = major == 2 ? Cbor::Kind::BYTES : Cbor::Kind::TEXT;
                    out.text = std::string{m_data.substr(m_position, argument)};
                    m_position += argument;
                    return out;
                case 4:
                case 5:
                    {
                        if (argument > 256) {
                            return failure("the CBOR collection is too large");
                        }
                        out.kind = major == 4 ? Cbor::Kind::ARRAY : Cbor::Kind::MAP;
                        for (std::uint64_t index = 0; index < argument; ++index) {
                            if (major == 4) {
                                auto item = read(depth + 1);
                                if (!item) {
                                    return item;
                                }
                                out.items.push_back(std::move(*item));
                                continue;
                            }
                            auto key = read(depth + 1);
                            auto value = key ? read(depth + 1) : Result<Cbor>{failure(key.error())};
                            if (!key || !value) {
                                return failure(!key ? key.error() : value.error());
                            }
                            if (!key->is(Cbor::Kind::INTEGER) && !key->is(Cbor::Kind::TEXT)) {
                                return failure("the CBOR map has a key that is not accepted");
                            }
                            std::string name = key->is(Cbor::Kind::INTEGER)
                                                   ? std::to_string(key->integer)
                                                   : key->text;
                            if (out.get(name) != nullptr) {
                                return failure("the CBOR map repeats a key");
                            }
                            out.members.emplace_back(std::move(name), std::move(*value));
                        }
                        return out;
                    }
                default:
                    return failure("the CBOR data has a tag, which is not accepted");
            }
        }

        [[nodiscard]] bool finished() const noexcept
        {
            return m_position == m_data.size();
        }

    private:
        std::string_view m_data;
        std::size_t m_position{0};
        int m_items{0};
    };

    /// One CBOR item that fills `bytes` completely.
    Result<Cbor> read_cbor(std::string_view bytes)
    {
        if (bytes.empty() || bytes.size() > MAX_CBOR) {
            return failure("the CBOR data is empty or too large");
        }
        CborReader reader{bytes};
        auto item = reader.read();
        if (!item) {
            return item;
        }
        if (!reader.finished()) {
            return failure("the CBOR data has bytes after the item");
        }
        return item;
    }

    bool has_bytes(const Cbor& map, const char* key, std::size_t size)
    {
        const Cbor* value = map.get(key);
        return value != nullptr && value->is(Cbor::Kind::BYTES) && value->text.size() == size;
    }

    std::int64_t integer_at(const Cbor& map, const char* key, std::int64_t fallback)
    {
        const Cbor* value = map.get(key);
        return value != nullptr && value->is(Cbor::Kind::INTEGER) ? value->integer : fallback;
    }

    /// The public key out of a COSE_Key; its algorithm and the DER of the key.
    Result<Credential> key_from_cose(std::string_view cose)
    {
        const auto map = read_cbor(cose);
        if (!map) {
            return failure(map.error());
        }
        if (!map->is(Cbor::Kind::MAP) || !map->get("1") || !map->get("3") ||
            !map->get("1")->is(Cbor::Kind::INTEGER) || !map->get("3")->is(Cbor::Kind::INTEGER)) {
            return failure("the public key is not a COSE key");
        }
        const std::int64_t type = integer_at(*map, "1", 0);
        const std::int64_t algorithm = integer_at(*map, "3", 0);
        Key key;
        if (type == 2 && algorithm == ES256) {
            if (integer_at(*map, "-1", 0) != 1 || !has_bytes(*map, "-2", 32) ||
                !has_bytes(*map, "-3", 32)) {
                return failure("the elliptic curve key is not a P-256 key");
            }
            const std::string& x = map->get("-2")->text;
            const std::string& y = map->get("-3")->text;
            std::unique_ptr<EC_KEY, decltype(&EC_KEY_free)> ec{
                EC_KEY_new_by_curve_name(NID_X9_62_prime256v1),
                &EC_KEY_free
            };
            std::unique_ptr<BIGNUM, decltype(&BN_free)> bx{
                BN_bin2bn(reinterpret_cast<const std::uint8_t*>(x.data()), x.size(), nullptr),
                &BN_free
            };
            std::unique_ptr<BIGNUM, decltype(&BN_free)> by{
                BN_bin2bn(reinterpret_cast<const std::uint8_t*>(y.data()), y.size(), nullptr),
                &BN_free
            };
            // Refuses a point that is not on the curve.
            if (!ec || !bx || !by ||
                EC_KEY_set_public_key_affine_coordinates(ec.get(), bx.get(), by.get()) != 1) {
                return failure("the public key is not a point of the curve");
            }
            key.reset(EVP_PKEY_new());
            if (!key || EVP_PKEY_set1_EC_KEY(key.get(), ec.get()) != 1) {
                return failure("cannot use the public key");
            }
        } else if (type == 3 && algorithm == RS256) {
            const Cbor* n = map->get("-1");
            const Cbor* e = map->get("-2");
            if (n == nullptr || e == nullptr || !n->is(Cbor::Kind::BYTES) ||
                !e->is(Cbor::Kind::BYTES)) {
                return failure("the RSA key is incomplete");
            }
            std::unique_ptr<BIGNUM, decltype(&BN_free)> bn{
                BN_bin2bn(
                    reinterpret_cast<const std::uint8_t*>(n->text.data()),
                    n->text.size(),
                    nullptr
                ),
                &BN_free
            };
            std::unique_ptr<BIGNUM, decltype(&BN_free)> be{
                BN_bin2bn(
                    reinterpret_cast<const std::uint8_t*>(e->text.data()),
                    e->text.size(),
                    nullptr
                ),
                &BN_free
            };
            if (!bn || !be || BN_num_bits(bn.get()) < 2'048 || BN_num_bits(bn.get()) > 8'192) {
                return failure("an RSA key of less than 2048 bits is refused");
            }
            std::unique_ptr<RSA, decltype(&RSA_free)> rsa{
                RSA_new_public_key(bn.get(), be.get()),
                &RSA_free
            };
            key.reset(EVP_PKEY_new());
            if (!rsa || !key || EVP_PKEY_set1_RSA(key.get(), rsa.get()) != 1) {
                return failure("cannot use the public key");
            }
        } else if (type == 1 && algorithm == EDDSA) {
            if (integer_at(*map, "-1", 0) != 6 || !has_bytes(*map, "-2", 32)) {
                return failure("the key is not an Ed25519 key");
            }
            const std::string& x = map->get("-2")->text;
            key.reset(EVP_PKEY_new_raw_public_key(
                EVP_PKEY_ED25519,
                nullptr,
                reinterpret_cast<const std::uint8_t*>(x.data()),
                x.size()
            ));
            if (!key) {
                return failure("cannot use the public key");
            }
        } else {
            return failure("the key algorithm is not supported");
        }
        std::uint8_t* der = nullptr;
        const int length = i2d_PUBKEY(key.get(), &der);
        if (length <= 0) {
            return failure("cannot store the public key");
        }
        Credential credential;
        credential.public_key.assign(
            reinterpret_cast<const char*>(der),
            static_cast<std::size_t>(length)
        );
        OPENSSL_free(der);
        credential.algorithm = static_cast<std::int32_t>(algorithm);
        return credential;
    }

    /// The client data: its type, challenge and origin checked against what was issued.
    Result<void> check_client_data(
        const RelyingParty& party,
        std::string_view challenge,
        std::string_view client_data_json,
        std::string_view type
    )
    {
        const auto json = util::Json::parse(client_data_json);
        if (!json || !json->is_object()) {
            return failure("the client data is not JSON");
        }
        const util::Json& kind = (*json)["type"];
        const util::Json& sent = (*json)["challenge"];
        const util::Json& origin = (*json)["origin"];
        if (!kind.is_string() || kind.string() != type) {
            return failure("the client data is for another operation");
        }
        if (!sent.is_string()) {
            return failure("the client data has no challenge");
        }
        const auto decoded = base64url_decode(sent.string());
        if (!decoded || decoded->size() != challenge.size() ||
            !util::constant_time_equals(*decoded, challenge)) {
            return failure("the challenge is not the one that was issued");
        }
        if (!origin.is_string() ||
            std::find(party.origins.begin(), party.origins.end(), origin.string()) ==
                party.origins.end()) {
            return failure("the origin is not one of this server's");
        }
        if (const util::Json& cross = (*json)["crossOrigin"]; cross.is_bool() && cross.boolean()) {
            return failure("a page of another origin cannot register or sign in");
        }
        return {};
    }

    struct AuthenticatorData
    {
        std::uint8_t flags{0};
        std::uint32_t counter{0};
        std::string_view rest{}; // after the fixed 37 bytes
    };

    Result<AuthenticatorData>
    read_authenticator_data(const RelyingParty& party, std::string_view data)
    {
        if (data.size() < 37) {
            return failure("the authenticator data is too short");
        }
        if (!util::constant_time_equals(data.substr(0, 32), sha256_of(party.id))) {
            return failure("the data is for another relying party");
        }
        AuthenticatorData out;
        out.flags = static_cast<std::uint8_t>(data[32]);
        if ((out.flags & FLAG_USER_PRESENT) == 0) {
            return failure("the person was not present");
        }
        // Backed up without being eligible for it is not a state a device can be in.
        if ((out.flags & FLAG_BACKED_UP) != 0 && (out.flags & FLAG_BACKUP_ELIGIBLE) == 0) {
            return failure("the backup flags contradict each other");
        }
        for (int index = 33; index < 37; ++index) {
            out.counter = (out.counter << 8U) | static_cast<unsigned char>(data[index]);
        }
        out.rest = data.substr(37);
        return out;
    }

    Result<void> verify_signature(
        const Credential& stored,
        std::string_view signed_data,
        std::string_view signature
    )
    {
        const auto* der = reinterpret_cast<const std::uint8_t*>(stored.public_key.data());
        CBS cbs;
        CBS_init(&cbs, der, stored.public_key.size());
        const Key key{EVP_parse_public_key(&cbs)};
        if (!key || CBS_len(&cbs) != 0) {
            return failure("the stored public key cannot be read");
        }
        const EVP_MD* digest = nullptr;
        const int type = EVP_PKEY_id(key.get());
        if (stored.algorithm == ES256 && type == EVP_PKEY_EC) {
            digest = EVP_sha256();
        } else if (stored.algorithm == RS256 && type == EVP_PKEY_RSA) {
            digest = EVP_sha256();
        } else if (!(stored.algorithm == EDDSA && type == EVP_PKEY_ED25519)) {
            return failure("the stored key does not fit its algorithm");
        }
        const std::unique_ptr<EVP_MD_CTX, ContextDeleter> context{EVP_MD_CTX_new()};
        if (!context ||
            EVP_DigestVerifyInit(context.get(), nullptr, digest, nullptr, key.get()) != 1 ||
            EVP_DigestVerify(
                context.get(),
                reinterpret_cast<const std::uint8_t*>(signature.data()),
                signature.size(),
                reinterpret_cast<const std::uint8_t*>(signed_data.data()),
                signed_data.size()
            ) != 1) {
            return failure("the signature is wrong");
        }
        return {};
    }

} // namespace

std::string base64url_encode(std::string_view bytes)
{
    std::string text = util::base64_encode(bytes);
    for (char& letter: text) {
        letter = letter == '+' ? '-' : (letter == '/' ? '_' : letter);
    }
    while (!text.empty() && text.back() == '=') {
        text.pop_back();
    }
    return text;
}

Result<std::string> base64url_decode(std::string_view text)
{
    std::string standard{text};
    // Only the url-safe alphabet, no padding: a "+" or "/" is not accepted here.
    if (standard.find_first_of("+/=") != std::string::npos) {
        return failure("not base64url");
    }
    for (char& letter: standard) {
        letter = letter == '-' ? '+' : (letter == '_' ? '/' : letter);
    }
    const auto decoded = util::base64_decode(standard);
    if (!decoded) {
        return failure("not base64url");
    }
    return *decoded;
}

Result<std::string> challenge_of(std::string_view client_data_json)
{
    const auto json = util::Json::parse(client_data_json);
    if (!json || !json->is_object()) {
        return failure("the client data is not JSON");
    }
    const util::Json& challenge = (*json)["challenge"];
    if (!challenge.is_string()) {
        return failure("the client data has no challenge");
    }
    return base64url_decode(challenge.string());
}

Result<ClientResponse> parse_client_response(std::string_view json_text, bool registration)
{
    const auto json = util::Json::parse(json_text);
    if (!json || !json->is_object()) {
        return failure("the credential is not JSON");
    }
    const util::Json& response = (*json)["response"];
    if (!response.is_object()) {
        return failure("the credential has no response");
    }
    const auto field = [&](const util::Json& object, const char* name) -> Result<std::string>
    {
        const util::Json& value = object[name];
        if (!value.is_string()) {
            return failure(std::string{"the credential has no "} + name);
        }
        return base64url_decode(value.string());
    };
    ClientResponse out;
    const auto raw_id = field(*json, "rawId");
    const auto client_data = field(response, "clientDataJSON");
    if (!raw_id || !client_data) {
        return failure(!raw_id ? raw_id.error() : client_data.error());
    }
    out.credential_id = *raw_id;
    out.client_data_json = *client_data;
    if (const util::Json& id = (*json)["id"]; id.is_string()) {
        // "id" is the same bytes as "rawId".
        const auto same = base64url_decode(id.string());
        if (!same || *same != out.credential_id) {
            return failure("the credential's id and rawId differ");
        }
    }
    if (const util::Json& kind = (*json)["type"];
        !kind.is_string() || kind.string() != "public-key") {
        return failure("the credential is not a public key credential");
    }
    if (registration) {
        const auto attestation = field(response, "attestationObject");
        if (!attestation) {
            return failure(attestation.error());
        }
        out.attestation_object = *attestation;
    } else {
        const auto data = field(response, "authenticatorData");
        const auto signature = field(response, "signature");
        if (!data || !signature) {
            return failure(!data ? data.error() : signature.error());
        }
        out.authenticator_data = *data;
        out.signature = *signature;
    }
    return out;
}

Result<Credential> verify_registration(
    const RelyingParty& party,
    std::string_view challenge,
    const ClientResponse& response,
    bool require_user_verification
)
{
    if (const auto client =
            check_client_data(party, challenge, response.client_data_json, "webauthn.create");
        !client) {
        return failure(client.error());
    }
    const auto attestation = read_cbor(response.attestation_object);
    if (!attestation) {
        return failure(attestation.error());
    }
    const Cbor* format = attestation->get("fmt");
    const Cbor* statement = attestation->get("attStmt");
    const Cbor* authenticator = attestation->get("authData");
    if (!attestation->is(Cbor::Kind::MAP) || format == nullptr || !format->is(Cbor::Kind::TEXT) ||
        format->text != "none" || authenticator == nullptr ||
        !authenticator->is(Cbor::Kind::BYTES)) {
        return failure("only attestation \"none\" is accepted");
    }
    if (statement != nullptr && (!statement->is(Cbor::Kind::MAP) || !statement->members.empty())) {
        return failure("an attestation \"none\" has no statement");
    }
    const std::string& auth_data = authenticator->text;
    const auto data = read_authenticator_data(party, auth_data);
    if (!data) {
        return failure(data.error());
    }
    if ((data->flags & FLAG_ATTESTED) == 0) {
        return failure("the authenticator sent no credential");
    }
    if ((data->flags & FLAG_EXTENSIONS) != 0) {
        return failure("extensions were not asked for");
    }
    const bool verified = (data->flags & FLAG_USER_VERIFIED) != 0;
    if (require_user_verification && !verified) {
        return failure("the person was not verified by the authenticator");
    }
    // AAGUID (16), credential id length (2), the id, then the COSE key to the end.
    std::string_view rest = data->rest;
    if (rest.size() < 18) {
        return failure("the attested credential data is too short");
    }
    const std::size_t id_length =
        (static_cast<unsigned char>(rest[16]) << 8U) | static_cast<unsigned char>(rest[17]);
    rest.remove_prefix(18);
    if (id_length == 0 || id_length > 1'023 || rest.size() <= id_length) {
        return failure("the credential id is not usable");
    }
    const std::string_view id = rest.substr(0, id_length);
    if (id != response.credential_id) {
        return failure("the credential id differs from the one in the response");
    }
    auto credential = key_from_cose(rest.substr(id_length));
    if (!credential) {
        return failure(credential.error());
    }
    credential->id = std::string{id};
    credential->counter = data->counter;
    credential->user_verified = verified;
    return credential;
}

Result<Assertion> verify_assertion(
    const RelyingParty& party,
    const Credential& stored,
    std::string_view challenge,
    const ClientResponse& response,
    bool require_user_verification
)
{
    if (!util::constant_time_equals(response.credential_id, stored.id)) {
        return failure("the credential is not the stored one");
    }
    if (const auto client =
            check_client_data(party, challenge, response.client_data_json, "webauthn.get");
        !client) {
        return failure(client.error());
    }
    const auto data = read_authenticator_data(party, response.authenticator_data);
    if (!data) {
        return failure(data.error());
    }
    const bool verified = (data->flags & FLAG_USER_VERIFIED) != 0;
    if (require_user_verification && !verified) {
        return failure("the person was not verified by the authenticator");
    }
    // The signature covers the authenticator data and the hash of the client data.
    const std::string signed_data =
        response.authenticator_data + sha256_of(response.client_data_json);
    if (const auto signature = verify_signature(stored, signed_data, response.signature);
        !signature) {
        return failure(signature.error());
    }
    // A counter that does not grow means a copy of the authenticator may be in use.
    if ((data->counter != 0 || stored.counter != 0) && data->counter <= stored.counter) {
        return failure("the signature counter did not grow: the authenticator may be cloned");
    }
    return Assertion{data->counter, verified};
}

} // namespace nc::webauthn
