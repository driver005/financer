load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_cc_library(
    name = "lib",
    srcs = ["src/database.cc"],
    hdrs = ["src/database.h"],
    includes = ["src"],
    deps = [
        "//sdk/util",
        "@sqlite3",
    ],
)

nc_plugin(
    name = "db",
    srcs = ["src/db_plugin.cc"],
    deps = [":lib"],
)

nc_cc_test(
    name = "db",
    srcs = ["tests/db.cc"],
    data = [":libdb.so"],
    deps = [
        ":lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
