load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test")

package(default_visibility = ["//visibility:public"])

# Text, URL, XML, base64, hash and time helpers shared by the runner and its plugins. Hashes, HMAC,
# PBKDF2 and random bytes come from BoringSSL, JSON parsing from nlohmann_json and XML reading from
# libxml2 (all linked statically, so a plugin stays self-contained).
nc_cc_library(
    name = "util",
    srcs = glob(["src/*.cc"]),
    hdrs = glob(["include/nextcloud/util/*.h"]),
    includes = ["include"],
    deps = [
        "@boringssl//:crypto",
        "@libxml2",
        "@nlohmann_json//:json",
    ],
)

nc_cc_test(
    name = "util",
    srcs = ["tests/util.cc"],
    deps = [
        ":util",
        "//sdk/testing",
    ],
)
