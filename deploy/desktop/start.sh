#!/bin/sh
# Starts Financer on this computer and opens it in your browser.
# Your data (financer.db) and login token (financer-token.txt) are kept in this folder.
cd "$(dirname "$0")" || exit 1

if [ ! -f financer-token.txt ]; then
  # 64 hex characters from the system's random source
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > financer-token.txt
  chmod 600 financer-token.txt
fi
TOKEN=$(cat financer-token.txt)

export FINANCER_API_TOKEN="$TOKEN"
export FINANCER_DATABASE_URL="sqlite://financer.db?mode=rwc"
export FINANCER_WEB_DIR="./web"
export FINANCER_BIND="127.0.0.1:8080"

echo "Financer is starting at http://127.0.0.1:8080"
echo "Your token (paste it under Settings the first time): $TOKEN"
(sleep 2; (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:8080) || (command -v open >/dev/null && open http://127.0.0.1:8080)) >/dev/null 2>&1 &
exec ./financer-server
