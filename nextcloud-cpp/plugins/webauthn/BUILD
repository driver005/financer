load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

# The WebAuthn checks without the plugin shell, so they are tested directly.
nc_cc_library(
    name = "lib",
    srcs = ["src/webauthn.cc"],
    hdrs = ["src/webauthn.h"],
    includes = ["src"],
    deps = [
        "//sdk/util",
        "@boringssl//:crypto",
    ],
)

nc_plugin(
    name = "webauthn",
    srcs = ["src/webauthn_plugin.cc"],
    deps = [":lib"],
)

nc_cc_test(
    name = "webauthn",
    srcs = ["tests/webauthn.cc"],
    data = [
        "tests/authenticator.py",
        ":libwebauthn.so",
        "//plugins/db:libdb.so",
        "//plugins/tokens:libtokens.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        ":lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
