load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

# The account store on its own, so it is tested without loading a plugin.
nc_cc_library(
    name = "store",
    srcs = ["src/user_store.cc"],
    hdrs = [
        "src/user.h",
        "src/user_store.h",
    ],
    includes = ["src"],
    deps = ["//sdk/util"],
)

nc_plugin(
    name = "users",
    srcs = ["src/users_plugin.cc"],
    deps = [":store"],
)

nc_cc_test(
    name = "users",
    srcs = ["tests/users.cc"],
    data = [":libusers.so"],
    deps = [
        ":store",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
