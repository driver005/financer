load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "admin_audit",
    srcs = ["src/admin_audit_plugin.cc"],
)

nc_cc_test(
    name = "admin_audit",
    srcs = ["tests/admin_audit.cc"],
    data = [
        ":libadmin_audit.so",
        "//plugins/cloud:libcloud.so",
        "//plugins/db:libdb.so",
        "//plugins/groups:libgroups.so",
        "//plugins/twofactor:libtwofactor.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//runner:kernel",
        "//sdk/testing",
    ],
)
