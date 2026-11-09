load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_cc_library(
    name = "lib",
    srcs = ["src/version.cc"],
    hdrs = ["src/version.h"],
    includes = ["src"],
)

nc_plugin(
    name = "updatenotification",
    srcs = ["src/updatenotification_plugin.cc"],
    deps = [
        ":lib",
        "//plugins/federation:lib",
    ],
)

nc_cc_test(
    name = "updatenotification",
    srcs = ["tests/updatenotification.cc"],
    data = [
        ":libupdatenotification.so",
        "//plugins/db:libdb.so",
        "//plugins/notifications:libnotifications.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        ":lib",
        "//plugins/federation:lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
