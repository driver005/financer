load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "webhook_listeners",
    srcs = ["src/webhook_listeners_plugin.cc"],
    deps = ["//plugins/federation:lib"],
)

nc_cc_test(
    name = "webhook_listeners",
    srcs = ["tests/webhook_listeners.cc"],
    data = [
        ":libwebhook_listeners.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//plugins/federation:lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
