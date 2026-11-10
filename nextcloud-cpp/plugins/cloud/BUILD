load("//bazel:build_defs.bzl", "nc_cc_library", "nc_cc_test", "nc_plugin")

package(default_visibility = ["//visibility:public"])

# Storage, WebDAV and shares without the plugin shell, so they are tested directly.
nc_cc_library(
    name = "lib",
    srcs = [
        "src/dav.cc",
        "src/file_cipher.cc",
        "src/ftp.cc",
        "src/s3.cc",
        "src/sftp.cc",
        "src/ssh_key.cc",
        "src/share_store.cc",
        "src/storage.cc",
    ],
    hdrs = [
        "src/dav.h",
        "src/file_cipher.h",
        "src/ftp.h",
        "src/remote_files.h",
        "src/s3.h",
        "src/sftp.h",
        "src/ssh_key.h",
        "src/share.h",
        "src/share_store.h",
        "src/storage.h",
    ],
    includes = ["src"],
    deps = [
        "//plugins/federation:lib",
        "//sdk/plugin:http",
        "//sdk/util",
        "@boringssl//:crypto",
        "@libssh2",
    ],
)

nc_plugin(
    name = "cloud",
    srcs = ["src/cloud_plugin.cc"],
    deps = [
        ":lib",
        "//plugins/federation:lib",
    ],
)

nc_cc_test(
    name = "cloud",
    srcs = ["tests/cloud.cc"],
    data = [
        ":libcloud.so",
        "//plugins/db:libdb.so",
        "//plugins/groups:libgroups.so",
        "//plugins/mail:libmail.so",
        "//plugins/users:libusers.so",
    ],
    deps = [
        ":lib",
        "//runner:kernel",
        "//sdk/testing",
        "@boringssl//:ssl",
    ],
)
