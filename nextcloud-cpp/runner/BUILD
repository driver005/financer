load("//bazel:build_defs.bzl", "nc_cc_binary", "nc_cc_library", "nc_cc_test")

package(default_visibility = ["//visibility:public"])

# The kernel: everything the runner is. No feature of the cloud lives here, only what plugins need to meet.
nc_cc_library(
    name = "kernel",
    srcs = glob(["src/*.cc"], exclude = ["src/main.cc"]),
    hdrs = glob(["include/nextcloud/runner/*.h"]),
    includes = ["include"],
    deps = [
        "//sdk/plugin:abi",
        "//sdk/plugin:http",
        "//sdk/plugin:sdk",
        "//sdk/util",
        "@boringssl//:ssl",
    ],
)

nc_cc_binary(
    name = "nextcloud",
    srcs = ["src/main.cc"],
    deps = [":kernel"],
)

nc_cc_test(
    name = "kernel",
    srcs = ["tests/kernel.cc"],
    deps = [
        ":kernel",
        "//sdk/testing",
    ],
)

test_suite(
    name = "all_tests",
    tests = [":kernel_test"],
)

