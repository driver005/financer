#include "nextcloud/test.h"
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
