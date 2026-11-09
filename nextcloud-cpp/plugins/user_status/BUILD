load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "user_status",
    srcs = ["src/user_status_plugin.cc"],
)

nc_cc_test(
    name = "user_status",
    srcs = ["tests/user_status.cc"],
    data = [
        ":libuser_status.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
