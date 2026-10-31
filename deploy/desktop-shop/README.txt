Financer shopping assistant for your computer
=============================================

1. Start it:   Windows: double-click start.bat      macOS / Linux: ./start.sh
2. Your browser opens at http://127.0.0.1:8090
3. More -> Settings -> server address http://127.0.0.1:8090 and the token the start script printed
   (also saved in shop-token.txt) -> "Connect".

It searches by itself, all the time, like a small search engine, but only the shops you list in
shop-sources.json. Open shop-sources.example.json for the three kinds (a shop search, a product
feed, a sitemap), copy what you need into shop-sources.json and restart. To check what a shop gives
without starting the server:   financer-shop-server --probe "pixel 9"
Reading shop pages may breach their terms; it is meant for personal use, obeys robots.txt and waits
between requests.

Everything stays on this computer: shop.db (what it found, price history) and shop-token.txt.
The program only listens on 127.0.0.1, so other computers cannot reach it.
Stop it with Ctrl+C (or close the window).

Deal alerts while the app is closed (optional, set before starting):
  FINANCER_SHOP_NTFY_URL=https://ntfy.sh/your-topic     a message on your phone through the ntfy app
  FINANCER_SHOP_WEBHOOK_URL=...                         a JSON POST to your own address
Reading pages that have no structured data with a model (optional):
  FINANCER_ANTHROPIC_API_KEY / FINANCER_OPENAI_API_KEY  (then set "use_llm": true on a source)
All options: docs/SHOP.md in the project.

macOS may ask you to allow the program the first time (right-click -> Open).
