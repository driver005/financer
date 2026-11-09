load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test")

package(default_visibility = ["//visibility:public"])

# The C ABI header on its own: what the runner includes. No plugin code, no std types across the line.
nc_cc_library(
    name = "abi",
    hdrs = ["include/nextcloud/abi.h"],
    includes = ["include"],
)

# The value types of a request and a response; header only, shared by the runner and the plugins.
nc_cc_library(
    name = "http",
    hdrs = [
        "include/nextcloud/http.h",
        "include/nextcloud/stream.h",
    ],
    includes = ["include"],
    deps = [
        ":abi",
        "//sdk/util",
    ],
)

# What a plugin includes: the base class, the host wrapper and NC_PLUGIN.
nc_cc_library(
    name = "sdk",
    hdrs = [
        "include/nextcloud/app.h",
        "include/nextcloud/db.h",
        "include/nextcloud/plugin.h",
    ],
    includes = ["include"],
    deps = [
        ":abi",
        ":http",
        "//sdk/util",
    ],
)

nc_cc_test(
    name = "app",
    srcs = ["tests/app.cc"],
    deps = [
        ":sdk",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
