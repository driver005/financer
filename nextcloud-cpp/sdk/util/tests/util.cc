#include "nextcloud/test.h"
#include "nextcloud/util/aead.h"
#include "nextcloud/util/crypto.h"
#include "nextcloud/util/text.h"

int main()
{
    using namespace nc::util;

    NC_CHECK_EQ(
        to_hex(sha256("")),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    NC_CHECK_EQ(
        to_hex(sha256("abc")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    NC_CHECK_EQ(
        to_hex(hmac_sha256("key", "The quick brown fox jumps over the lazy dog")),
        "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
    );
    // RFC 7914 section 11 test vector for PBKDF2-HMAC-SHA-256.
    NC_CHECK_EQ(
        to_hex(pbkdf2_sha256("passwd", "salt", 1)),
        "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc"
    );

    // RFC 3174 / RFC 2202 (SHA-1, HMAC-SHA-1), RFC 4648 (base32), RFC 4226 / RFC 6238 (HOTP, TOTP).
    NC_CHECK_EQ(to_hex(sha1("abc")), "a9993e364706816aba3e25717850c26c9cd0d89d");
    NC_CHECK_EQ(to_hex(sha1("")), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
    NC_CHECK_EQ(
        to_hex(hmac_sha1("key", "The quick brown fox jumps over the lazy dog")),
        "de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9"
    );
    NC_CHECK_EQ(base32_encode("foobar"), "MZXW6YTBOI");
    NC_CHECK_EQ(base32_decode("mzxw6ytboi").value_or("?"), "foobar");
    NC_CHECK(!base32_decode("MZ1").has_value());
    NC_CHECK_EQ(hotp("12345678901234567890", 0), "755224");
    NC_CHECK_EQ(hotp("12345678901234567890", 9), "520489");
    NC_CHECK_EQ(hotp("12345678901234567890", 59 / 30, 8), "94287082");
    NC_CHECK_EQ(hotp("12345678901234567890", 1'111'111'109 / 30, 8), "07081804");
    // ChaCha20-Poly1305 against vectors made with an independent implementation (key 0..31,
    // nonce 12..23, associated data "header", plaintext byte i = (7 i + 3) mod 256).
    {
        std::string key, nonce;
        for (int index = 0; index < 32; ++index) {
            key.push_back(static_cast<char>(index));
        }
        for (int index = 12; index < 24; ++index) {
            nonce.push_back(static_cast<char>(index));
        }
        const auto plain = [](int length)
        {
            std::string out;
            for (int index = 0; index < length; ++index) {
                out.push_back(static_cast<char>((index * 7 + 3) % 256));
            }
            return out;
        };
        const std::pair<int, const char*> vectors[] = {
            {0, "86d47ac8c8f1905473ccd0fa5eaae333"},
            {1, "bbf73702621bd72eeea3c83e0a188a3f"},
            {15, "fad4da908c1863b87299ad953f47b75f"},
            {16, "8a34a56eb28b7aecdd96c04fa925739d"},
            {17, "88944f5d61c2f61d388c3f6e57a0383e"},
            {64, "a46c809d763c8430aca04b9fac66fbf6"},
            {65, "3f632de105d9c679105f19c679150526"},
            {1'000, "ecdca8b524f096264beae9563e8226d9"},
        };
        for (const auto& [length, digest]: vectors) {
            const std::string sealed = chacha20_poly1305_seal(key, nonce, "header", plain(length));
            NC_CHECK_EQ(to_hex(sha256(sealed)).substr(0, 32), digest);
            NC_CHECK_EQ(
                chacha20_poly1305_open(key, nonce, "header", sealed).value_or("?"),
                plain(length)
            );
        }
        NC_CHECK_EQ(
            to_hex(chacha20_poly1305_seal(key, nonce, "header", "")),
            "5231046b7ee4f7309dc582601cebd40c"
        );
        // Any change is noticed: the data, the tag, the associated data, the nonce, the key.
        std::string sealed = chacha20_poly1305_seal(key, nonce, "header", plain(100));
        NC_CHECK(chacha20_poly1305_open(key, nonce, "header", sealed).has_value());
        std::string flipped = sealed;
        flipped[10] = static_cast<char>(flipped[10] ^ 1);
        NC_CHECK(!chacha20_poly1305_open(key, nonce, "header", flipped).has_value());
        std::string bad_tag = sealed;
        bad_tag.back() = static_cast<char>(bad_tag.back() ^ 1);
        NC_CHECK(!chacha20_poly1305_open(key, nonce, "header", bad_tag).has_value());
        NC_CHECK(!chacha20_poly1305_open(key, nonce, "other", sealed).has_value());
        std::string other_nonce = nonce;
        other_nonce[0] = static_cast<char>(other_nonce[0] ^ 1);
        NC_CHECK(!chacha20_poly1305_open(key, other_nonce, "header", sealed).has_value());
        std::string other_key = key;
        other_key[0] = static_cast<char>(other_key[0] ^ 1);
        NC_CHECK(!chacha20_poly1305_open(other_key, nonce, "header", sealed).has_value());
        NC_CHECK(!chacha20_poly1305_open(key, nonce, "header", "short").has_value());
    }
    NC_CHECK_EQ(from_hex("00ff7A").value_or("?"), std::string("\x00\xff\x7a", 3));
    NC_CHECK(!from_hex("abc").has_value() && !from_hex("zz").has_value());
    NC_CHECK_EQ(base64_encode("Aladdin:open sesame"), "QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
    NC_CHECK_EQ(base64_decode("QWxhZGRpbjpvcGVuIHNlc2FtZQ==").value_or("?"), "Aladdin:open sesame");
    NC_CHECK(!base64_decode("a$b").has_value());

    NC_CHECK_EQ(url_decode("a%20b%2Fc+d"), "a b/c+d");
    NC_CHECK_EQ(url_decode("a+b", true), "a b");
    NC_CHECK_EQ(url_decode("100%"), "100%");
    NC_CHECK_EQ(url_encode_path("Photos/my file.txt"), "Photos/my%20file.txt");
    NC_CHECK_EQ(xml_escape("a<b&\"c\""), "a&lt;b&amp;&quot;c&quot;");
    NC_CHECK_EQ(json_escape("a\"b\n"), "a\\\"b\\n");

    const auto form = parse_form("to=a%40b.de&subject=Hi+there&empty=&flag");
    NC_CHECK_EQ(form.size(), std::size_t{4});
    NC_CHECK_EQ(form_value(form, "to"), "a@b.de");
    NC_CHECK_EQ(form_value(form, "subject"), "Hi there");
    NC_CHECK_EQ(form_value(form, "nope"), "");
    NC_CHECK_EQ(form_encode({{"k", "a b&c"}, {"x", "ü"}}), "k=a%20b%26c&x=%C3%BC");
    NC_CHECK_EQ(form_value(parse_form(form_encode({{"k", "a b&c=d"}})), "k"), "a b&c=d");
    NC_CHECK_EQ(std::string(mime_type_for("Photo.JPG")), "image/jpeg");
    NC_CHECK_EQ(std::string(mime_type_for("noext")), "application/octet-stream");
    NC_CHECK(
        is_valid_email("a.b@example.org") && !is_valid_email("a@b") && !is_valid_email("a@x..y")
    );
    NC_CHECK(!is_valid_email("a@example.org\r\nBcc: x@y.z") && !is_valid_email("<a@b.de>"));
    NC_CHECK_EQ(split("a//b", '/').size(), std::size_t{3});
    NC_CHECK_EQ(std::string(trim("  hi \n")), "hi");
    NC_CHECK(equals_ignore_case("Content-Type", "content-type"));
    NC_CHECK_EQ(random_hex(8).size(), std::size_t{16});
    NC_CHECK(constant_time_equals("abc", "abc") && !constant_time_equals("abc", "abd"));

    return NC_TEST_RESULT();
}
