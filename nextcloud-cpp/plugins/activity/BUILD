load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "activity",
    srcs = ["src/activity_plugin.cc"],
)

nc_cc_test(
    name = "activity",
    srcs = ["tests/activity.cc"],
    data = [
        ":libactivity.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
