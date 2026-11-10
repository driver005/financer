load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "files_reminders",
    srcs = ["src/files_reminders_plugin.cc"],
)

nc_cc_test(
    name = "files_reminders",
    srcs = ["tests/files_reminders.cc"],
    data = [
        ":libfiles_reminders.so",
        "//plugins/cloud:libcloud.so",
        "//plugins/db:libdb.so",
        "//plugins/notifications:libnotifications.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
