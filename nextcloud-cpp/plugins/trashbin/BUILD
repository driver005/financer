load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "trashbin",
    srcs = ["src/trashbin_plugin.cc"],
)

nc_cc_test(
    name = "trashbin",
    srcs = ["tests/trashbin.cc"],
    data = [
        ":libtrashbin.so",
        "//plugins/cloud:libcloud.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
