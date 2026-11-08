#!/usr/bin/env bash
# Starts the real runner with the built plugins and walks through a few requests with curl.
# Usage: tools/smoke.sh          (builds first)
set -euo pipefail

cd "$(dirname "$0")/.."
bazelisk build //runner:nextcloud //plugins/users:libusers.so //plugins/cloud:libcloud.so //plugins/mail:libmail.so

work="$(mktemp -d)"
trap 'kill "${server:-0}" 2>/dev/null || true; rm -rf "$work"' EXIT
mkdir -p "$work/plugins"
cp bazel-bin/plugins/users/libusers.so bazel-bin/plugins/cloud/libcloud.so bazel-bin/plugins/mail/libmail.so "$work/plugins/"
cat > "$work/config.conf" <<CONF
data_dir = $work/data
port = 0
plugin_dir = $work/plugins
[users]
pbkdf2_iterations = 1000
[mail]
from_address = cloud@example.org
CONF

run="bazel-bin/runner/nextcloud --config $work/config.conf"
$run plugin:list
OC_PASS='correct horse battery' $run user:add alice --email=alice@example.org
$run user:list

port=18080
$run serve --port "$port" 2> "$work/server.log" &
server=$!
for _ in $(seq 50); do curl -fs "http://127.0.0.1:$port/status.php" >/dev/null 2>&1 && break; sleep 0.1; done

dav="http://127.0.0.1:$port/remote.php/dav/files/alice"
auth=(-u 'alice:correct horse battery')
echo "--- status.php";    curl -s "http://127.0.0.1:$port/status.php"; echo
echo "--- anonymous PROPFIND (expect 401)"; curl -s -o /dev/null -w '%{http_code}\n' -X PROPFIND "$dav/"
echo "--- PUT (expect 201)"; curl -s -o /dev/null -w '%{http_code}\n' "${auth[@]}" -T README.md "$dav/readme.md"
echo "--- PROPFIND";      curl -s "${auth[@]}" -X PROPFIND -H 'Depth: 1' "$dav/" | grep -E 'href|getcontentlength'
echo "--- share link";    curl -s "${auth[@]}" -d 'path=/readme.md&shareType=3' "http://127.0.0.1:$port/ocs/v2.php/apps/files_sharing/api/v1/shares"; echo
echo "--- mail spool";    ls "$work/data/mail-spool" || true
kill "$server"; wait "$server" 2>/dev/null || true
echo "smoke test finished"
