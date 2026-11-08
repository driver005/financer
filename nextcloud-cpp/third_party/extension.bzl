"""bzlmod module extension loading every third_party/<name>/repo.bzl (there is no WORKSPACE to load them from)."""

load("//bazel/toolchain/system_cc:repo.bzl", system_cc_repo = "repo")

def _third_party_impl(module_ctx):
    system_cc_repo()

third_party_deps = module_extension(implementation = _third_party_impl)
