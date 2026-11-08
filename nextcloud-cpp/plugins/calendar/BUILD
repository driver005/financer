load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "calendar",
    srcs = ["src/calendar_plugin.cc"],
    deps = ["//plugins/davobjects:lib"],
)

nc_cc_test(
    name = "calendar",
    srcs = ["tests/calendar.cc"],
    data = [
        ":libcalendar.so",
        "//plugins/contacts:libcontacts.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//plugins/davobjects:lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
