load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "lookup",
    srcs = ["src/lookup_plugin.cc"],
    deps = ["//plugins/federation:lib"],
)

nc_cc_test(
    name = "lookup",
    srcs = ["tests/lookup.cc"],
    data = [
        ":liblookup.so",
        "//plugins/cloud:libcloud.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//plugins/federation:lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
