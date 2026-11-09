load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

# Outgoing HTTP(S) to other servers: certificate and host name checked, local addresses refused.
nc_cc_library(
    name = "lib",
    srcs = ["src/http_client.cc"],
    hdrs = ["src/http_client.h"],
    includes = ["src"],
    deps = [
        "//sdk/plugin:http",
        "//sdk/util",
        "@boringssl//:ssl",
    ],
)

nc_plugin(
    name = "federation",
    srcs = ["src/federation_plugin.cc"],
    deps = [":lib"],
)

nc_cc_test(
    name = "http_client",
    srcs = ["tests/http_client.cc"],
    deps = [
        ":lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)

nc_cc_test(
    name = "federation",
    srcs = ["tests/federation.cc"],
    data = [
        ":libfederation.so",
        "//plugins/cloud:libcloud.so",
        "//plugins/db:libdb.so",
        "//plugins/notifications:libnotifications.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        ":lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)

test_suite(
    name = "all_tests",
    tests = [
        ":federation_test",
        ":http_client_test",
    ],
)
