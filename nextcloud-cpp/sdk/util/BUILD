load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test")

package(default_visibility = ["//visibility:public"])

# Text, URL, XML, base64, SHA-256 and time helpers shared by the runner and its plugins. No dependency
# beyond the standard library, so a plugin links it statically and stays self-contained.
nc_cc_library(
    name = "util",
    srcs = glob(["src/*.cc"]),
    hdrs = glob(["include/nextcloud/util/*.h"]),
    includes = ["include"],
)

nc_cc_test(
    name = "util",
    srcs = ["tests/util.cc"],
    deps = [
        ":util",
        "//sdk/testing",
    ],
)
