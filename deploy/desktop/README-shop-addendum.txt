
The shopping assistant (this build only)
----------------------------------------
This build also contains the shopping assistant: Settings -> Groceries -> Shopping assistant. It uses
the same server and the same token, keeps its own data (financer-shop.db) and searches by itself all
the time, but only the shops you list in shop-sources.json in this folder. shop-sources.example.json
shows the three kinds (a shop search, a product feed, a sitemap); restart after editing.
Switch the assistant off with FINANCER_SHOP_ENABLED=false.
Deal alerts while the app is closed: FINANCER_SHOP_NTFY_URL=https://ntfy.sh/your-topic
All options: docs/SHOP.md in the project.
