#!/usr/bin/env bash
# Starts the real runner with the built plugins and walks through a few requests with curl.
# Usage: tools/smoke.sh          (builds first)
set -euo pipefail

cd "$(dirname "$0")/.."

plugins=(db users tokens groups cloud trashbin versions mail activity notifications calendar contacts systemtags comments twofactor)
targets=(//runner:nextcloud)
for plugin in "${plugins[@]}"; do targets+=("//plugins/$plugin:lib$plugin.so"); done
bazelisk build "${targets[@]}"

work="$(mktemp -d)"
trap 'kill "${server:-0}" 2>/dev/null || true; rm -rf "$work"' EXIT
mkdir -p "$work/plugins"
cp bazel-bin/plugins/*/lib*.so "$work/plugins/"
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
echo "--- DELETE goes to the trash, then restore"
curl -s -o /dev/null -w '%{http_code}\n' "${auth[@]}" -X DELETE "$dav/readme.md"
curl -s "${auth[@]}" "http://127.0.0.1:$port/ocs/v2.php/apps/files_trashbin/api/v1/trash"; echo
curl -s -o /dev/null -w '%{http_code}\n' "${auth[@]}" -X POST "http://127.0.0.1:$port/ocs/v2.php/apps/files_trashbin/api/v1/trash/1/restore"
echo "--- CalDAV: put an event, list the calendar"
printf 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:smoke-1\r\nDTSTART:20300101T100000Z\r\nSUMMARY:Smoke\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n' |
    curl -s -o /dev/null -w '%{http_code}\n' "${auth[@]}" -T - "http://127.0.0.1:$port/remote.php/dav/calendars/alice/personal/smoke.ics"
curl -s "${auth[@]}" -X PROPFIND -H 'Depth: 1' "http://127.0.0.1:$port/remote.php/dav/calendars/alice/personal/" | grep -c 'smoke.ics'
echo "--- activity"
curl -s "${auth[@]}" "http://127.0.0.1:$port/ocs/v2.php/apps/activity/api/v2/activity"; echo
echo "--- mail spool";    ls "$work/data/mail-spool" || true
kill "$server"; wait "$server" 2>/dev/null || true
echo "smoke test finished"
