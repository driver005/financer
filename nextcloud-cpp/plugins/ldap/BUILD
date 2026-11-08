load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_cc_library(
    name = "lib",
    srcs = [
        "src/ber.cc",
        "src/ldap_client.cc",
    ],
    hdrs = [
        "src/ber.h",
        "src/ldap_client.h",
    ],
    includes = ["src"],
    deps = ["//sdk/util"],
)

nc_plugin(
    name = "ldap",
    srcs = ["src/ldap_plugin.cc"],
    deps = [":lib"],
)

nc_cc_test(
    name = "ldap",
    srcs = ["tests/ldap.cc"],
    data = [
        ":libldap.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        ":lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
