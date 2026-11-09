load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "settings",
    srcs = ["src/settings_plugin.cc"],
)

nc_cc_test(
    name = "settings",
    srcs = ["tests/settings.cc"],
    data = [
        ":libsettings.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
