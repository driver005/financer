load("//bazel:build_defs.bzl", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "weather_status",
    srcs = ["src/weather_status_plugin.cc"],
    deps = ["//plugins/federation:lib"],
)

nc_cc_test(
    name = "weather_status",
    srcs = ["tests/weather_status.cc"],
    data = [
        ":libweather_status.so",
        "//plugins/db:libdb.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        "//plugins/federation:lib",
        "//runner:kernel",
        "//sdk/testing",
    ],
)
