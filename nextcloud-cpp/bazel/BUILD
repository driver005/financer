exports_files(["build_defs.bzl", "copts.bzl", "conditionals.bzl"])

# `bazelisk test //... --define=std=26` builds the tree as C++26 instead of C++23 (CI does, with clang 22).
config_setting(
    name = "std26",
    define_values = {"std": "26"},
    visibility = ["//visibility:public"],
)
