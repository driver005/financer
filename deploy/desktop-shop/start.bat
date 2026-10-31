@echo off
rem Starts the Financer shopping assistant on this computer and opens it in your browser.
rem Your data (shop.db), login token (shop-token.txt) and the shops it reads (shop-sources.json) are kept in this folder.
cd /d "%~dp0"

if not exist shop-token.txt (
  powershell -NoProfile -Command "$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join '' | Set-Content -NoNewline shop-token.txt"
)
set /p FINANCER_SHOP_API_TOKEN=<shop-token.txt
rem no shops yet: copy and edit shop-sources.example.json, or write your own list
if not exist shop-sources.json >shop-sources.json echo [] 

set FINANCER_SHOP_DATABASE_URL=sqlite://shop.db?mode=rwc
set FINANCER_SHOP_WEB_DIR=.\web
set FINANCER_SHOP_BIND=127.0.0.1:8090
set FINANCER_SHOP_SOURCES=.\shop-sources.json

echo The shopping assistant is starting at http://127.0.0.1:8090
echo Your token (paste it under More, Settings the first time): %FINANCER_SHOP_API_TOKEN%
start "" http://127.0.0.1:8090
financer-shop-server.exe
