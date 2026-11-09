load("@rules_cc//cc:defs.bzl", "cc_library")

# Sean Barrett's single-header image libraries, vendored. Each is used by exactly one source file
# (plugins/previews/src/image.cc), which defines the *_IMPLEMENTATION macros before including them.
cc_library(
    name = "stb",
    hdrs = [
        "stb_image.h",
        "stb_image_resize2.h",
        "stb_image_write.h",
    ],
    includes = ["."],
    visibility = ["//visibility:public"],
)
