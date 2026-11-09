load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_cc_library(
    name = "lib",
    srcs = ["src/image.cc"],
    hdrs = ["src/image.h"],
    includes = ["src"],
    deps = [
        "//sdk/util",
        "//third_party/stb",
        "@libwebp",
        "@lunasvg",
    ],
)

nc_plugin(
    name = "previews",
    srcs = ["src/previews_plugin.cc"],
    deps = [":lib"],
)

nc_cc_test(
    name = "previews",
    srcs = ["tests/previews.cc"],
    data = [
        ":libpreviews.so",
        "//plugins/cloud:libcloud.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        ":lib",
        "//runner:kernel",
        "//sdk/testing",
        "@libwebp",
    ],
)
