load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "systemtags",
    srcs = ["src/systemtags_plugin.cc"],
)

nc_cc_test(
    name = "systemtags",
    srcs = ["tests/systemtags.cc"],
    data = [
        ":libsystemtags.so",
        "//plugins/cloud:libcloud.so",
        "//plugins/db:libdb.so",
        "//plugins/groups:libgroups.so",
        "//plugins/notifications:libnotifications.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
