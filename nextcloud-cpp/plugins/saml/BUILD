load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

# SAML 2.0 service provider logic without the plugin shell, so it is tested directly.
nc_cc_library(
    name = "lib",
    srcs = ["src/saml.cc"],
    hdrs = ["src/saml.h"],
    includes = ["src"],
    deps = [
        "//sdk/util",
        "@boringssl//:ssl",
        "@libxml2",
        "@zlib",
    ],
)

nc_plugin(
    name = "saml",
    srcs = ["src/saml_plugin.cc"],
    deps = [":lib"],
)

nc_cc_test(
    name = "saml",
    srcs = ["tests/saml.cc"],
    data = [
        ":libsaml.so",
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
