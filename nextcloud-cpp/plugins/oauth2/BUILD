load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "oauth2",
    srcs = ["src/oauth2_plugin.cc"],
)

nc_cc_test(
    name = "oauth2",
    srcs = ["tests/oauth2.cc"],
    data = [
        ":liboauth2.so",
        "//plugins/db:libdb.so",
        "//plugins/twofactor:libtwofactor.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
