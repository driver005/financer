## Two ways to run Financer

Every release contains both. Pick one.

| | **Compact** (everything on your phone) | **Server + client** (you host the server) |
|---|---|---|
| What it is | One app with the Rust backend inside. Your data stays in the app's private storage. | A server (the same Rust code) plus thin apps that talk to it. |
| Android | `financer-compact-android.apk` | `financer-client-android.apk` |
| iOS Simulator (Apple-silicon Mac) | `financer-compact-ios-simulator.zip` | `financer-client-ios-simulator.zip` |
| Server | not needed | `financer-desktop-<platform>` bundles (Windows `.zip`; macOS and Linux `.tar.gz`; start with `start.bat` / `./start.sh`), or the Docker image `ghcr.io/driver005/financer-server` |
| Web | not available | `financer-web.zip` (the same app in a browser, served by the server) |
| Good for | One person, one phone, no hosting, nothing leaves the device | Several devices, scheduled price refresh while the phone sleeps, a browser or desktop |
| Limits | Price refresh runs only when the app is open or the OS grants background time (always-on is not possible on iOS) | You run and secure a server |

The APKs are signed with the debug key unless the repository has release-signing secrets. The compact variant has run on an Android emulator in CI but not yet on a physical phone. Installing on an iPhone needs your own signing (EAS build).

## The shopping assistant

A second app that compares products and subscriptions from the web and tells you about deals (see `docs/SHOP.md`). It comes in two flavours; the files are only there when their build succeeded.

| | **Shopping only** | **Inside the finance app** |
|---|---|---|
| Android | `financer-shopping-client-android.apk` (needs its server), `financer-shopping-compact-android.apk` (searches when you press Search) | `financer-bundle-client-android.apk`, `financer-bundle-compact-android.apk` |
| iOS Simulator | `financer-shopping-*-ios-simulator.zip` | `financer-bundle-*-ios-simulator.zip` |
| Server | `financer-shop-desktop-<platform>` bundles, Docker image `ghcr.io/driver005/financer-shop-server` | `financer-bundle-desktop-<platform>` bundles, Docker image `ghcr.io/driver005/financer-bundle-server` |

The server searches all the time and notifies about new deals; the phone only searches when you press Search. You tell it which shops to read in `shop-sources.json` (an example is in each server bundle). None of these builds has been run on a phone yet.
