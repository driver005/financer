load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "notifications",
    srcs = ["src/notifications_plugin.cc"],
)

nc_cc_test(
    name = "notifications",
    srcs = ["tests/notifications.cc"],
    data = [
        ":libnotifications.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
