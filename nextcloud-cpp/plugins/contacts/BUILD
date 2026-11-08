load("//bazel:build_defs.bzl", "nc_plugin")

package(default_visibility = ["//visibility:public"])

nc_plugin(
    name = "contacts",
    srcs = ["src/contacts_plugin.cc"],
    deps = ["//plugins/davobjects:lib"],
)
