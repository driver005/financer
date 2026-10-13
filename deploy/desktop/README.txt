Financer for your computer
==========================

1. Start it:   Windows: double-click start.bat      macOS / Linux: ./start.sh
2. Your browser opens at http://127.0.0.1:8080
3. Settings -> paste the token that the start script printed (also saved in financer-token.txt)
   -> "Test and save".

Everything stays on this computer: financer.db (your data) and financer-token.txt.
The program only listens on 127.0.0.1, so other computers cannot reach it.
Stop it with Ctrl+C (or close the window).

Settings file: the first start creates financer.toml in this folder. Everything in it is
commented out; remove the leading # of a line to use a setting (API keys, a bank account to sync
on a schedule, your own supermarket spellings). The full list of options is in the project's
financer.example.toml and docs/CONFIG.md. Settings made by the start script (token, database,
address) win over the file. Check it with:  financer-server --check-config

Optional (set before starting, see the project's README):
  FINANCER_ANTHROPIC_API_KEY / FINANCER_OPENAI_API_KEY   recipe ideas and receipt photo scan
  FINANCER_FINTS_PRODUCT_ID                              live Sparkasse sync
  FINANCER_PRICE_SOURCES                                 price pages

macOS may ask you to allow the program the first time (right-click -> Open).
