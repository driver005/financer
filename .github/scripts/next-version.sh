#!/usr/bin/env bash
# Prints the next version tag (vMAJOR.MINOR.PATCH), or nothing when there is nothing to release.
#
#   next-version.sh [auto|patch|minor|major]
#
# The latest v* tag is the current version. With "auto" the commits since it decide the bump:
#   breaking  ("type!:" subject or a "BREAKING CHANGE" line)  -> major
#   "feat:" / "feat(scope):"                                  -> minor
#   anything else                                             -> patch
# A merge commit counts with its body, which for a pull request is the PR title, so a PR titled
# "feat: ..." makes a minor release. With no tag yet, the first release is the version in the
# Rust workspace (Cargo.toml), unbumped. Nothing is printed if HEAD is already tagged or the
# latest commit says [skip release].
set -euo pipefail
mode="${1:-auto}"

last=$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n1)

if [ -z "$last" ]; then
  base=$(sed -n '/^\[workspace.package\]/,/^\[/{s/^version *= *"\([^"]*\)".*/\1/p}' Cargo.toml | head -n1)
  echo "v${base:?no workspace version in Cargo.toml}"
  exit 0
fi

[ "$(git rev-list -n1 "$last")" = "$(git rev-parse HEAD)" ] && exit 0
git log -1 --format=%B | grep -qi '\[skip release\]' && exit 0

if [ "$mode" = auto ]; then
  log=$(git log --format=%B "$last"..HEAD)
  if grep -qE '^[a-z]+(\([^)]*\))?!:|^BREAKING[ -]CHANGE' <<<"$log"; then mode=major
  elif grep -qE '^feat(\([^)]*\))?:' <<<"$log"; then mode=minor
  else mode=patch; fi
fi

IFS=. read -r major minor patch <<<"${last#v}"
case "$mode" in
  major) echo "v$((major + 1)).0.0" ;;
  minor) echo "v${major}.$((minor + 1)).0" ;;
  patch) echo "v${major}.${minor}.$((patch + 1))" ;;
  *) echo "unknown bump: $mode" >&2; exit 2 ;;
esac
