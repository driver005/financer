load("@rules_cc//cc/toolchains:args.bzl", "cc_args")
load("@rules_cc//cc/toolchains:tool.bzl", "cc_tool")
load("@rules_cc//cc/toolchains:tool_map.bzl", "cc_tool_map")
load("@rules_cc//cc/toolchains:toolchain.bzl", "cc_toolchain")

# System clang resolves headers to real absolute paths (/usr/include, /usr/include/c++/N,
# /usr/lib/clang/<version>/include) rather than paths relative to a Bazel-tracked toolchain input, since it
# is the host install and not a relocated hermetic one. Allowlist them so Bazel's absolute-path-inclusion
# check does not reject every target that includes libstdc++ or libc headers.
cc_args(
    name = "absolute_system_includes",
    actions = ["@rules_cc//cc/toolchains/actions:compile_actions"],
    allowlist_absolute_include_directories = [
        "/usr/include",
        "/usr/local/include",
        "/usr/lib/clang",
        "/usr/lib/gcc",
        "/usr/lib/llvm-18",
    ],
    tags = ["manual"],
)

cc_tool(
    name = "clang",
    src = "@system_cc//:clang",
    tags = ["manual"],
)

cc_tool(
    name = "clang++",
    src = "@system_cc//:clang++",
    tags = ["manual"],
)

cc_tool(
    name = "ar",
    src = "@system_cc//:ar",
    tags = ["manual"],
)

cc_tool(
    name = "strip",
    src = "@system_cc//:strip",
    tags = ["manual"],
)

cc_tool_map(
    name = "tools",
    tags = ["manual"],
    tools = {
        "@rules_cc//cc/toolchains/actions:assembly_actions": ":clang",
        "@rules_cc//cc/toolchains/actions:c_compile": ":clang",
        "@rules_cc//cc/toolchains/actions:cpp_compile_actions": ":clang++",
        "@rules_cc//cc/toolchains/actions:link_actions": ":clang++",
        "@rules_cc//cc/toolchains/actions:ar_actions": ":ar",
        "@rules_cc//cc/toolchains/actions:strip": ":strip",
    },
)

cc_toolchain(
    name = "system_clang",
    args = [":absolute_system_includes"],
    compiler = "clang",
    tool_map = ":tools",
    # Backfills the legacy default arg sets (archiver flags, link flags, compile input/output flags, PIC,
    # library search dirs). Without it ar and ld are invoked with no arguments at all.
    known_features = [
        "@rules_cc//cc/toolchains/args:experimental_replace_legacy_action_config_features",
    ],
    enabled_features = ["@rules_cc//cc/toolchains/args:experimental_replace_legacy_action_config_features"],
)

toolchain(
    name = "system_clang_toolchain",
    exec_compatible_with = [
        "@platforms//os:linux",
        "@platforms//cpu:x86_64",
    ],
    target_compatible_with = [
        "@platforms//os:linux",
        "@platforms//cpu:x86_64",
    ],
    toolchain = ":system_clang",
    toolchain_type = "@bazel_tools//tools/cpp:toolchain_type",
    visibility = ["//visibility:public"],
)
