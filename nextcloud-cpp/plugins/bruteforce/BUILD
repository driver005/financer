load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "bruteforce",
    srcs = ["src/bruteforce_plugin.cc"],
)

nc_cc_test(
    name = "bruteforce",
    srcs = ["tests/bruteforce.cc"],
    data = [
        ":libbruteforce.so",
        "//plugins/db:libdb.so",
        "//plugins/tokens:libtokens.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
