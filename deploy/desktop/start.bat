@echo off
rem Starts Financer on this computer and opens it in your browser.
rem Your data (financer.db) and login token (financer-token.txt) are kept in this folder.
cd /d "%~dp0"

if not exist financer-token.txt (
  powershell -NoProfile -Command "$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ($b | ForEach-Object { $_.ToString('x2') }) -join '' | Set-Content -NoNewline financer-token.txt"
)
set /p FINANCER_API_TOKEN=<financer-token.txt
set FINANCER_DATABASE_URL=sqlite://financer.db?mode=rwc
set FINANCER_WEB_DIR=.\web
set FINANCER_BIND=127.0.0.1:8080

echo Financer is starting at http://127.0.0.1:8080
echo Your token (paste it under Settings the first time): %FINANCER_API_TOKEN%
start "" http://127.0.0.1:8080
financer-server.exe
