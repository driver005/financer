load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "groups",
    srcs = ["src/groups_plugin.cc"],
)

nc_cc_test(
    name = "groups",
    srcs = ["tests/groups.cc"],
    data = [
        ":libgroups.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
