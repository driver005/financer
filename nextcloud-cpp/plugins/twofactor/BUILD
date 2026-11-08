load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "twofactor",
    srcs = ["src/twofactor_plugin.cc"],
)

nc_cc_test(
    name = "twofactor",
    srcs = ["tests/twofactor.cc"],
    data = [
        ":libtwofactor.so",
        "//plugins/db:libdb.so",
        "//plugins/tokens:libtokens.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
