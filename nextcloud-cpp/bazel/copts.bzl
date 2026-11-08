"""Project-wide copts, same shape as congelado's bazel/copts.bzl."""

load("//bazel:conditionals.bzl", "if_linux")

def nc_copts():
    """Compiler flags every nextcloud-cpp library, plugin and binary uses."""
    return [
        "-fPIC",
        "-stdlib=libstdc++",
        "-Iinclude",
        "-Wall",
        "-Wextra",
        "-Wshadow",
        "-Wnon-virtual-dtor",
        "-Woverloaded-virtual",
    ]

def nc_linkopts():
    """Linker flags for targets that load plugins (dl) or run threads (pthread)."""
    return if_linux(["-lpthread", "-ldl"])
