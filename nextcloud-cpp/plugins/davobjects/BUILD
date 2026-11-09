load("//bazel:build_defs.bzl", "nc_cc_library")

package(default_visibility = ["//visibility:public"])

# The CalDAV/CardDAV server shared by the calendar and contacts plugins; each links it into its own .so.
nc_cc_library(
    name = "lib",
    srcs = [
        "src/collection_server.cc",
        "src/itip.cc",
    ],
    hdrs = [
        "src/collection_server.h",
        "src/itip.h",
    ],
    includes = ["src"],
    deps = [
        "//sdk/plugin:sdk",
        "//sdk/util",
    ],
)
