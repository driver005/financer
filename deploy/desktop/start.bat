@echo off
rem Starts Financer on this computer and opens it in your browser.
rem Your data (financer.db), login token (financer-token.txt) and settings (financer.toml) are kept in this folder.
cd /d "%~dp0"

if not exist financer-token.txt (
  powershell -NoProfile -Command "$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join '' | Set-Content -NoNewline financer-token.txt"
)
set /p FINANCER_API_TOKEN=<financer-token.txt
rem a settings file next to the token; everything in it is commented out
if exist financer.toml goto have_config
>financer.toml echo # Financer server settings. Everything is commented out: remove the leading # of a line to use it.
>>financer.toml echo # Settings made by start.sh/start.bat (token, database, listen address) win over this file.
>>financer.toml echo # Full list of options: financer.example.toml in the project, and docs/CONFIG.md.
>>financer.toml echo # Do not write secrets here if you can avoid it: use ${NAME} to read an environment variable.
echo.>>financer.toml
>>financer.toml echo [llm]
>>financer.toml echo #anthropic_api_key = "${ANTHROPIC_API_KEY}"
>>financer.toml echo #openai_api_key = "${OPENAI_API_KEY}"
echo.>>financer.toml
>>financer.toml echo [bank]
>>financer.toml echo #fints_product_id = "${FINTS_PRODUCT_ID}"
echo.>>financer.toml
>>financer.toml echo # Sync a bank account on a schedule. The PIN is never stored here: type it in the app, or
>>financer.toml echo # name an environment variable with pin_env. You still approve every login in your banking app.
>>financer.toml echo #[[bank.accounts]]
>>financer.toml echo #name = "Girokonto"
>>financer.toml echo #bank_code = "37050198"
>>financer.toml echo #login = "your-login-name"
>>financer.toml echo #iban = "DE89 3704 0044 0532 0130 00"
>>financer.toml echo #sync_every_hours = 12
echo.>>financer.toml
>>financer.toml echo # Bank texts that belong to a supermarket chain (for the Stores screen).
>>financer.toml echo #[[stores]]
>>financer.toml echo #chain = "edeka"
>>financer.toml echo #match = ["Mueller Frischemarkt"]
echo.>>financer.toml
>>financer.toml echo [receipts]
:have_config
set FINANCER_DATABASE_URL=sqlite://financer.db?mode=rwc
set FINANCER_WEB_DIR=.\web
set FINANCER_BIND=127.0.0.1:8080
rem the bundled build (with the shopping assistant) reads the shops listed here; other builds ignore it
if exist shop-sources.json set FINANCER_SHOP_SOURCES=.\shop-sources.json

echo Financer is starting at http://127.0.0.1:8080
echo Your token (paste it under Settings the first time): %FINANCER_API_TOKEN%
start "" http://127.0.0.1:8080
financer-server.exe
