#!/bin/sh
# Builds the fints-rs mock bank (FinTS 3.0 server) with decoupled-TAN (pushTAN) support.
#
# fints-rs 0.2.0's mock accepts TAN requests with a stub, so TAN challenges and polling cannot be
# exercised. decoupled-tan.patch (in this directory) implements the stub that the mock's own
# (unused) TanState enum was meant for: init answers 0030/3955 with a HITAN challenge, polls
# (HKTAN process S) answer 3956 until --auto-confirm-secs have passed, then 0020.
#
# usage: mock/build.sh <output directory>     (writes <dir>/fints-server)
set -eu
out=$(cd "$(dirname "${1:?usage: build.sh <output directory>}")" && pwd)/$(basename "$1")
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

curl -fsSL https://static.crates.io/crates/fints-rs/fints-rs-0.2.0.crate | tar xz -C "$work"
cd "$work/fints-rs-0.2.0"
patch -p1 < "$here/decoupled-tan.patch"
cargo build --locked --features server --bin fints-server
mkdir -p "$out"
cp target/debug/fints-server "$out/fints-server"
echo "built $out/fints-server"
