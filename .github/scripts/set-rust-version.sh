#!/usr/bin/env bash
# Stamp a release version into the Rust workspace, so the server binary and the Docker image carry
# the tag's version.
#
#   set-rust-version.sh vX.Y.Z      (run from the repository root)
#
# Sets [workspace.package] version in Cargo.toml and the matching version of every workspace crate
# (financer-*) in Cargo.lock, so builds with --locked keep working. Only plain awk and mv are
# used, so it behaves the same on Linux, macOS and Git Bash on Windows. The release workflow
# calls it only for version tags; nothing is committed.
set -euo pipefail

tag="${1:-}"
if ! [[ "$tag" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "set-rust-version: not a version tag (expected vMAJOR.MINOR.PATCH): '$tag'" >&2
  exit 2
fi
version="${tag#v}"
# 1.02.3 -> 1.2.3, the same normalisation apps/mobile/scripts/set-version.mjs does.
version="$((10#${BASH_REMATCH[1]})).$((10#${BASH_REMATCH[2]})).$((10#${BASH_REMATCH[3]}))"

[ -f Cargo.toml ] || { echo "set-rust-version: run it from the repository root" >&2; exit 2; }

# Cargo.toml: the first version line in the [workspace.package] section.
awk -v v="$version" '
  /^\[/ { section = $0 }
  section ~ /^\[workspace\.package\]/ && !done && /^version[ \t]*=/ { print "version = \"" v "\""; done = 1; next }
  { print }
  END { if (!done) exit 3 }
' Cargo.toml > Cargo.toml.new || { rm -f Cargo.toml.new; echo "set-rust-version: no [workspace.package] version in Cargo.toml" >&2; exit 3; }
mv Cargo.toml.new Cargo.toml

# Cargo.lock: each workspace crate is a [[package]] with name = "financer-..." and no source.
if [ -f Cargo.lock ]; then
  awk -v v="$version" '
    /^\[\[package\]\]/ { ours = 0 }
    /^name = "financer-/ { ours = 1 }
    ours && /^version = / { print "version = \"" v "\""; ours = 0; next }
    { print }
  ' Cargo.lock > Cargo.lock.new
  mv Cargo.lock.new Cargo.lock
fi

echo "Rust workspace version set to $version"
