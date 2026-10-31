#!/bin/sh
# Starts the Financer shopping assistant on this computer and opens it in your browser.
# Your data (shop.db), login token (shop-token.txt) and the shops it reads (shop-sources.json) are kept in this folder.
cd "$(dirname "$0")" || exit 1

if [ ! -f shop-token.txt ]; then
  # 64 hex characters from the system's random source
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > shop-token.txt
  chmod 600 shop-token.txt
fi
TOKEN=$(cat shop-token.txt)

if [ ! -f shop-sources.json ]; then
  # no shops yet: copy and edit shop-sources.example.json, or write your own list
  echo '[]' > shop-sources.json
fi

export FINANCER_SHOP_API_TOKEN="$TOKEN"
export FINANCER_SHOP_DATABASE_URL="sqlite://shop.db?mode=rwc"
export FINANCER_SHOP_WEB_DIR="./web"
export FINANCER_SHOP_BIND="127.0.0.1:8090"
export FINANCER_SHOP_SOURCES="./shop-sources.json"

echo "The shopping assistant is starting at http://127.0.0.1:8090"
echo "Your token (paste it under More -> Settings the first time): $TOKEN"
(sleep 2; (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:8090) || (command -v open >/dev/null && open http://127.0.0.1:8090)) >/dev/null 2>&1 &
exec ./financer-shop-server
