#!/bin/sh
# Starts Financer on this computer and opens it in your browser.
# Your data (financer.db), login token (financer-token.txt) and settings (financer.toml) are kept in this folder.
cd "$(dirname "$0")" || exit 1

if [ ! -f financer-token.txt ]; then
  # 64 hex characters from the system's random source
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n' > financer-token.txt
  chmod 600 financer-token.txt
fi
TOKEN=$(cat financer-token.txt)

if [ ! -f financer.toml ]; then
  # settings file next to the token; everything in it is commented out
  cat > financer.toml <<'FINANCER_TOML'
# Financer server settings. Everything is commented out: remove the leading # of a line to use it.
# Settings made by start.sh/start.bat (token, database, listen address) win over this file.
# Full list of options: financer.example.toml in the project, and docs/CONFIG.md.
# Do not write secrets here if you can avoid it: use ${NAME} to read an environment variable.

[llm]
#anthropic_api_key = "${ANTHROPIC_API_KEY}"
#openai_api_key = "${OPENAI_API_KEY}"

[bank]
#fints_product_id = "${FINTS_PRODUCT_ID}"

# Sync a bank account on a schedule. The PIN is never stored here: type it in the app, or
# name an environment variable with pin_env. You still approve every login in your banking app.
#[[bank.accounts]]
#name = "Girokonto"
#bank_code = "37050198"
#login = "your-login-name"
#iban = "DE89 3704 0044 0532 0130 00"
#sync_every_hours = 12

# Bank texts that belong to a supermarket chain (for the Stores screen).
#[[stores]]
#chain = "edeka"
#match = ["Mueller Frischemarkt"]

[receipts]
FINANCER_TOML
  chmod 600 financer.toml
fi

export FINANCER_API_TOKEN="$TOKEN"
export FINANCER_DATABASE_URL="sqlite://financer.db?mode=rwc"
export FINANCER_WEB_DIR="./web"
export FINANCER_BIND="127.0.0.1:8080"
# the bundled build (with the shopping assistant) reads the shops listed here; other builds ignore it
if [ -f shop-sources.json ]; then export FINANCER_SHOP_SOURCES="./shop-sources.json"; fi

echo "Financer is starting at http://127.0.0.1:8080"
echo "Your token (paste it under Settings the first time): $TOKEN"
(sleep 2; (command -v xdg-open >/dev/null && xdg-open http://127.0.0.1:8080) || (command -v open >/dev/null && open http://127.0.0.1:8080)) >/dev/null 2>&1 &
exec ./financer-server
