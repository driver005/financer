# Top level of nextcloud-cpp. Targets live in their own packages: sdk/plugin, runner, plugins/*.

exports_files([
    ".clang-format",
    ".clangd",
    "CODESTYLE.md",
])

test_suite(
    name = "all_tests",
    tests = [
        "//runner:all_tests",
        "//plugins:all_tests",
    ],
)
