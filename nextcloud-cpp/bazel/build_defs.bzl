"""Build macros in the style of congelado's bazel/build_defs.bzl: one place that owns copts, the language
standard and the plugin packaging, so a BUILD file only lists sources and deps.

The language standard is set per target (as congelado does) and not globally, so a target can be moved
to another standard on its own.
"""

load("@rules_cc//cc:defs.bzl", "cc_binary", "cc_library", "cc_test")
load("//bazel:copts.bzl", "nc_copts", "nc_linkopts")

def nc_cxx_copts():
    """Default copts for all own targets, including the language standard.

    C++23 by default; `--define=std=26` selects C++26 (congelado's standard), which CI uses with clang 22.
    """
    return nc_copts() + select({
        "//bazel:std26": ["-std=gnu++26"],
        "//conditions:default": ["-std=gnu++23"],
    })

def nc_cc_library(name, copts = nc_cxx_copts(), **kwargs):
    """Own cc_library. Passing copts replaces the defaults, merge nc_cxx_copts() yourself."""
    cc_library(
        name = name,
        copts = copts,
        **kwargs
    )

def nc_cc_binary(name, copts = nc_cxx_copts(), **kwargs):
    """Own cc_binary. Links dl and pthread because every binary may host plugins."""
    linkopts = kwargs.pop("linkopts", [])
    cc_binary(
        name = name,
        copts = copts,
        linkopts = nc_linkopts() + linkopts,
        **kwargs
    )

def nc_cc_test(name, srcs, deps = [], copts = nc_cxx_copts(), **kwargs):
    """Own cc_test (`<name>_test`); a plain `int main`, exit code 0 is a pass."""
    linkopts = kwargs.pop("linkopts", [])
    cc_test(
        name = name + "_test",
        srcs = srcs,
        copts = copts,
        linkopts = nc_linkopts() + linkopts,
        deps = deps,
        **kwargs
    )

def nc_plugin(name, srcs, deps = [], hdrs = [], copts = nc_cxx_copts(), **kwargs):
    """A runner plugin: a shared object `lib<name>.so` exporting `nc_plugin_api` through NC_PLUGIN.

    The plugin links the SDK statically and nothing else of the runner, so it can be built and shipped
    without the kernel, exactly like congelado's plugins.
    """
    cc_binary(
        name = "lib" + name + ".so",
        srcs = srcs + hdrs,
        copts = copts + ["-fvisibility=hidden", "-fvisibility-inlines-hidden"],
        linkshared = True,
        linkopts = nc_linkopts(),
        deps = deps + ["//sdk/plugin:sdk"],
        **kwargs
    )
