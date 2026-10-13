#!/usr/bin/env bash
# Checks .github/scripts/next-version.sh on throw-away git repositories: normal bumps, and the
# dependency-only merges that must not start a release. Run: bash .github/scripts/test-next-version.sh
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/next-version.sh"
fails=0

new_repo() { # a repo with one tagged release
  dir=$(mktemp -d); cd "$dir"
  git init -q -b master; git config user.name t; git config user.email t@example.com
  mkdir -p crates/a apps/mobile .github/workflows src
  printf '[workspace.package]\nversion = "0.1.0"\n' > Cargo.toml
  echo base > src/main.rs; echo '{}' > apps/mobile/package.json
  git add -A; git commit -qm "start"; git tag -a v1.2.3 -m v1.2.3
}
commit() { # commit "message" file...
  msg=$1; shift
  for f in "$@"; do mkdir -p "$(dirname "$f")"; echo "$RANDOM" >> "$f"; done
  git add -A; git commit -qm "$msg"
}
merge_branch() { # merge_branch branch "merge message" file...
  b=$1; msg=$2; shift 2
  git checkout -q -b "$b"; for f in "$@"; do mkdir -p "$(dirname "$f")"; echo "$RANDOM" >> "$f"; done
  git add -A; git commit -qm "change"; git checkout -q master; git merge -q --no-ff "$b" -m "$msg"
}
expect() { # expect "name" "expected" [mode]
  got=$(bash "$script" "${3:-auto}")
  if [ "$got" = "$2" ]; then echo "ok   $1"; else echo "FAIL $1: expected '$2', got '$got'"; fails=$((fails + 1)); fi
}

new_repo; commit "Fix the budget screen" src/main.rs;                       expect "plain change is a patch" v1.2.4
new_repo; commit "feat: stores screen" src/main.rs;                          expect "feat is a minor" v1.3.0
new_repo; commit "feat!: new backup format" src/main.rs;                     expect "breaking is a major" v2.0.0
new_repo; commit "Fix it [skip release]" src/main.rs;                        expect "[skip release] skips" ""
new_repo;                                                                    expect "already tagged is nothing" ""
cd "$(mktemp -d)"; git init -q -b master; git config user.name t; git config user.email t@e.com
printf '[workspace.package]\nversion = "0.1.0"\n' > Cargo.toml; git add -A; git commit -qm one; expect "first release is the Cargo version" v0.1.0

new_repo; merge_branch dependabot/cargo/sha2-0.11.0 "Merge pull request #4 from me/dependabot/cargo/sha2-0.11.0" src/main.rs
expect "merge of a dependabot branch is skipped" ""
new_repo; commit "Bump tower-http from 0.6 to 0.7 (#7)" Cargo.lock crates/a/Cargo.toml
expect "lockfile and manifest only is skipped" ""
new_repo; commit "Bump actions/setup-java from 4 to 6" .github/workflows/ci.yml .github/dependabot.yml
expect "workflow files only is skipped" ""
new_repo; commit "Bump expo" apps/mobile/package.json apps/mobile/package-lock.json
expect "app manifest and lockfile only is skipped" ""
new_repo; commit "Add a dependency and use it" Cargo.lock src/main.rs
expect "dependency change with source code is released" v1.2.4
new_repo; merge_branch feature/stores "Merge pull request #9 from me/feature/stores" src/main.rs
expect "an ordinary merge is released" v1.2.4
new_repo; merge_branch dependabot/cargo/age-0.12.1 "Merge pull request #6 from me/dependabot/cargo/age-0.12.1" Cargo.lock
expect "a forced patch ignores the dependency rule" v1.2.4 patch
new_repo; commit "Bump base64" Cargo.lock
expect "a forced minor ignores the dependency rule" v1.3.0 minor

[ "$fails" -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
