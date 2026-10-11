# Building and releasing

One GitHub workflow, `.github/workflows/release.yml`, builds everything you can install.

**Start it**
- Push a version tag: `git tag v1.0.0 && git push --tags`. Everything is built and attached to a
  GitHub release.
- Or open the repository's **Actions** tab, pick **Release builds** and **Run workflow**. Choose
  what to build (`all`, `desktop-and-web`, `docker` or `mobile`; only `docker` and `all` publish an image) and the phone build profile.

Ordinary pushes still run only the tests (`ci.yml`).

## What you get

| Output | Needs | Notes |
|---|---|---|
| **Desktop bundles**: Windows, macOS (Apple silicon and Intel), Linux | nothing | The server plus the web app. Unzip, double-click `start.bat` (Windows) or run `./start.sh`; the browser opens. Data stays in the folder. Not signed, so macOS and Windows warn on first start. |
| **Web app** (zip) | nothing | The same app, to host yourself. It needs the server on the same address (the desktop bundle and the Docker image do that with `FINANCER_WEB_DIR`). |
| **Docker image** `ghcr.io/<owner>/financer-server` | nothing | For your own server, see `deploy/`. Version tags and `latest` on tags, `edge` on manual runs. |
| **Android app** (APK) | `EXPO_TOKEN` | Built in the cloud by EAS Build. |
| **iOS app** | `EXPO_TOKEN` (+ Apple account for real devices) | `preview` builds for the iOS **simulator** (macOS only, no Apple account). Installing on an iPhone needs the `device` or `production` profile and a paid Apple Developer account. |

There is no native desktop app: Expo targets phones and the web. The desktop bundle runs the web
app in your browser, served by the local server.

## One-time setup for the phone apps

1. Create a free account at <https://expo.dev>.
2. In `apps/mobile`: `npx eas-cli login`, then `npx eas-cli init`. This writes the project id into
   `app.json`; commit that change.
3. Create an access token (expo.dev, Account settings, Access tokens) and add it to the
   repository as the secret **`EXPO_TOKEN`** (Settings, Secrets and variables, Actions).
4. For iPhones or the stores: run `npx eas-cli credentials` once and follow the Apple prompts.
   Android needs nothing for APKs; EAS makes a signing key for store builds.

Without `EXPO_TOKEN` the phone jobs skip themselves with a notice; the rest still builds.

## What is not in the phone builds yet

The Rust backend that runs **inside** the phone (`EMBEDDED.md`) is not part of these builds: its
native build was never done. The phone apps therefore run in "Server" mode and talk to a server
you host (or the desktop bundle on your network). `eas.json` is where that would be added.

## What was and was not tested

- The workflow file passes `actionlint`.
- A test run on GitHub's own runners built the web app and the desktop bundles for Linux,
  macOS (Apple silicon and Intel) and Windows, and the Linux bundle was also assembled and run
  locally (start script, web app, API, token). The Windows and macOS bundles were built but
  **not started** on those systems.
- The Docker job and the release job (attaching files to a GitHub release) have **not run**; they
  only run for a published tag or a manual `docker` run.
- The EAS (phone) jobs skip themselves without `EXPO_TOKEN` (that path was exercised); the build
  itself has never run, since it needs your Expo account.
