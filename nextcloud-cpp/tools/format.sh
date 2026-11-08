#!/usr/bin/env bash
# Formats every C++ file with the repository's .clang-format (copied from congelado).
#
# The .clang-format uses options that only exist in newer clang-format releases (it is written for clang
# 22). When the installed clang-format does not know an option, this script formats with a temporary copy
# of the config that leaves that option out, so older tools still give a close result.
# Usage: tools/format.sh [--check]
set -euo pipefail
cd "$(dirname "$0")/.."

mode=(-i)
[[ "${1:-}" == "--check" ]] && mode=(--dry-run --Werror)

tool="${CLANG_FORMAT:-clang-format}"
config=".clang-format"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

probe="$("$tool" --style=file --dry-run sdk/util/src/text.cc 2>&1 || true)"
if [[ "$probe" == *"Error reading"* ]]; then
    python3 - "$tool" "$tmp" <<'PY'
import re, subprocess, sys
tool, out = sys.argv[1], sys.argv[2]
lines = open(".clang-format").read().split("\n")
lines = ["BinPackParameters: false" if l.startswith("BinPackParameters:") else l for l in lines]
for _ in range(100):
    open(out, "w").write("\n".join(lines))
    run = subprocess.run([tool, "--style=file:" + out, "--dry-run", "sdk/util/src/text.cc"], capture_output=True, text=True)
    hit = re.search(re.escape(out) + r":(\d+):\d+: error", run.stderr)
    if not hit:
        break
    start = int(hit.group(1)) - 1
    while start > 0 and (lines[start].startswith(" ") or lines[start] == ""):
        start -= 1
    end = start + 1
    while end < len(lines) and lines[end].startswith(" "):
        end += 1
    print("clang-format: ignoring option not known to this version:", lines[start], file=sys.stderr)
    del lines[start:end]
PY
    config="$tmp"
fi

if [[ "$config" == ".clang-format" ]]; then
    style=(--style=file)
else
    style=(--style="file:$config")
fi
find sdk runner plugins -name '*.cc' -o -name '*.h' | sort | xargs "$tool" "${style[@]}" "${mode[@]}"
