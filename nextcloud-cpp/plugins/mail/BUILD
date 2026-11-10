load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

# Message building and the transports, without the plugin shell, so they are tested directly.
nc_cc_library(
    name = "lib",
    srcs = [
        "src/mime.cc",
        "src/transport.cc",
    ],
    hdrs = [
        "src/mail_message.h",
        "src/mime.h",
        "src/transport.h",
    ],
    includes = ["src"],
    deps = [
        "//sdk/util",
        "@boringssl//:ssl",
    ],
)

nc_plugin(
    name = "mail",
    srcs = ["src/mail_plugin.cc"],
    deps = [":lib"],
)

nc_cc_test(
    name = "mail",
    srcs = ["tests/mail.cc"],
    data = [
        ":libmail.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        ":lib",
        "//runner:kernel",
        "//sdk/testing",
        "@boringssl//:ssl",
    ],
)
