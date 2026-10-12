# Building and releasing

One GitHub workflow, `.github/workflows/release.yml`, builds everything you can install.

**Start it**
- Merge to `master`: the **New version** workflow (`version.yml`) tags the merge with the next
  version and starts this build for the tag, so every merge becomes a release. See below.
- Push a version tag: `git tag v1.0.0 && git push --tags`. Everything is built and attached to a
  GitHub release.
- Or open the repository's **Actions** tab, pick **Release builds** and **Run workflow**. Choose
  what to build (`all`, `desktop-and-web`, `docker` or `mobile`; only `docker` and `all` publish an image) and the phone build profile.

Ordinary pushes to other branches still run only the tests (`ci.yml`).

## Automatic versions on merge

`.github/workflows/version.yml` runs on every push to `master`, which is what a merged pull
request is. It takes the latest `vX.Y.Z` tag as the current version and raises it by looking at the
commits since then (`.github/scripts/next-version.sh`):

| Commits since the last tag contain | Bump |
|---|---|
| a breaking change (`feat!: ...` or a `BREAKING CHANGE` line) | major |
| `feat: ...` or `feat(scope): ...` | minor |
| anything else | patch |

A pull request's merge commit carries the PR title, so a PR titled `feat: budget screen` makes a
minor version. The first release (no tag yet) is the version in `Cargo.toml` (`v0.1.0`) as it is.

The workflow then pushes an annotated tag and starts **Release builds** on it (a tag pushed with
the workflow's own token does not start other workflows, so it is started explicitly). The
release gets the desktop bundles, web zip, APK and generated notes as described above.

- Skip one: put `[skip release]` in the merge commit message.
- Force a bump: Actions tab, **New version**, **Run workflow**, choose `patch`, `minor` or `major`.
- The tag is the version. `package.json`, `app.json` and `Cargo.toml` are not edited by the
  workflow (it makes no commits to `master`), so those numbers do not follow the tags.
- If you protect tags with a ruleset, allow `github-actions[bot]` to create `v*` tags.
- It only runs once the file is on `master`; it cannot tag from a branch.
- Not yet run: the bump script is tested on a scratch repo and the file passes `actionlint`,
  but the workflow itself has not run on GitHub, so the tag push and the dispatch of the release
  build are unproven until the first merge.

## What you get

| Output | Needs | Notes |
|---|---|---|
| **Desktop bundles**: Windows, macOS (Apple silicon and Intel), Linux | nothing | The server plus the web app. Unzip, double-click `start.bat` (Windows) or run `./start.sh`; the browser opens. Data stays in the folder. Not signed, so macOS and Windows warn on first start. |
| **Web app** (zip) | nothing | The same app, to host yourself. It needs the server on the same address (the desktop bundle and the Docker image do that with `FINANCER_WEB_DIR`). |
| **Docker image** `ghcr.io/<owner>/financer-server` | nothing | For your own server, see `deploy/`. Version tags and `latest` on tags, `edge` on manual runs. |
| **Android app** (APK), built on the runner | nothing | The `android-apk` job runs `expo prebuild` and Gradle on GitHub's runner (about 16 minutes) and uploads `financer-android.apk`. Signed with the debug key: fine to install yourself, not for the Play Store. It is the app in "Server" mode (no on-phone backend). Included in tag releases and in a manual run with `all` or `android-apk`. |
| **Android app** (APK), built by EAS | `EXPO_TOKEN` | Built in the cloud by EAS Build. |
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
- The `android-apk` job ran on GitHub (manual run) and **produced an APK** (about 16 minutes).
  The APK has **not been installed or run on a device**.
- The Docker job and the release job (attaching files to a GitHub release) have **not run**; they
  only run for a published tag or a manual `docker` run.
- The EAS (phone) jobs skip themselves without `EXPO_TOKEN` (that path was exercised); the build
  itself has never run, since it needs your Expo account.
