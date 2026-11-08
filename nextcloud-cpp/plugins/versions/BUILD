load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "versions",
    srcs = ["src/versions_plugin.cc"],
)

nc_cc_test(
    name = "versions",
    srcs = ["tests/versions.cc"],
    data = [
        ":libversions.so",
        "//plugins/cloud:libcloud.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
