"""Exposes /usr/bin (system clang + binutils) as a Bazel repo.

Same reason as congelado's: rules_cc's auto-detected default toolchain (cc_configure_extension) is broken
under Bazel 9, because it calls the removed native cc_toolchain_suite. So the toolchain is declared by
hand with rules_cc's modern cc_toolchain API. Unlike congelado's, it carries none of the C++ modules
plumbing (module actions, dependency scanner wrapper, modmap files): this tree uses plain headers.
"""

load("@bazel_tools//tools/build_defs/repo:local.bzl", "new_local_repository")

def repo():
    new_local_repository(
        name = "system_cc",
        path = "/usr/bin",
        build_file = "//bazel/toolchain/system_cc:system_cc.BUILD",
    )
