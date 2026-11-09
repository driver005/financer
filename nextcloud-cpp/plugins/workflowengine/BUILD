load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_cc_library(
    name = "lib",
    srcs = ["src/glob.cc"],
    hdrs = ["src/glob.h"],
    includes = ["src"],
)

nc_plugin(
    name = "workflowengine",
    srcs = ["src/workflowengine_plugin.cc"],
    deps = [":lib"],
)

nc_cc_test(
    name = "workflowengine",
    srcs = ["tests/workflowengine.cc"],
    data = [
        ":libworkflowengine.so",
        "//plugins/cloud:libcloud.so",
        "//plugins/db:libdb.so",
        "//plugins/notifications:libnotifications.so",
        "//plugins/systemtags:libsystemtags.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        ":lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
