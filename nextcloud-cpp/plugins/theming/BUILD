load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_cc_library(
    name = "lib",
    srcs = ["src/color.cc"],
    hdrs = ["src/color.h"],
    includes = ["src"],
)

nc_plugin(
    name = "theming",
    srcs = ["src/theming_plugin.cc"],
    deps = [":lib"],
)

nc_cc_test(
    name = "theming",
    srcs = ["tests/theming.cc"],
    data = [
        ":libtheming.so",
        "//plugins/db:libdb.so",
        "//plugins/settings:libsettings.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        ":lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
