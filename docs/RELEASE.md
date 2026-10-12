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
- The tag is the version. The tagging workflow makes no commits to `master`, so the numbers in
  `package.json`, `app.json` and `Cargo.toml` stay as committed; instead the release build stamps
  the tag's version into the build it makes (see "Version numbers" below). The app, the web zip,
  the desktop bundles and the Docker image therefore carry the tag's version.
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
| **Android app** (APK), built on the runner | nothing | The `android-apk` job runs `expo prebuild` and Gradle on GitHub's runner (about 16 minutes) and uploads `financer-android.apk`. Signed with the debug key unless you add the signing secrets (see "Signing the Android app"): the debug key is fine to install yourself, not for the Play Store. It is the app in "Server" mode (no on-phone backend). Included in tag releases and in a manual run with `all` or `android-apk`. |
| **Android app** (APK), built by EAS | `EXPO_TOKEN` | Built in the cloud by EAS Build. |
| **iOS app** | `EXPO_TOKEN` (+ Apple account for real devices) | `preview` builds for the iOS **simulator** (macOS only, no Apple account). Installing on an iPhone needs the `device` or `production` profile and a paid Apple Developer account. |

There is no native desktop app: Expo targets phones and the web. The desktop bundle runs the web
app in your browser, served by the local server.

## Version numbers

For a build of a version tag (`github.ref_type == 'tag'`, which includes the build that **New
version** starts by dispatching on the tag), each job first writes the tag's version into its own
checkout. Nothing is committed or pushed. A manual run from a branch keeps the versions in the
repository.

| Job | What is stamped | By |
|---|---|---|
| `web`, `android-apk`, `mobile` (EAS) | `expo.version`, `expo.android.versionCode`, `expo.ios.buildNumber` in `app.json`; `version` in `package.json` and `package-lock.json` | `apps/mobile/scripts/set-version.mjs vX.Y.Z` |
| `desktop`, `docker` | `[workspace.package] version` in `Cargo.toml` and the `financer-*` entries of `Cargo.lock` (so `--locked` still passes) | `.github/scripts/set-rust-version.sh vX.Y.Z` |

- Only plain `vMAJOR.MINOR.PATCH` tags are accepted; anything else fails the build instead of
  producing a wrongly numbered app.
- **Build number** (Android `versionCode`, iOS `buildNumber`): derived from the version as
  `major * 1000000 + minor * 1000 + patch`, so `v1.2.3` is `1002003`. Stores need a number that
  only goes up, and this goes up with every new version, gives the same number if a tag is built
  again, and needs no counter stored anywhere. Limits: minor and patch below 1000. To use another
  number run the script yourself with `--build N`.
- The EAS (`mobile`) job keeps the stamped files in a **local** commit, because EAS builds what is
  committed. With the `production` profile `eas.json` uses `appVersionSource: remote` and
  `autoIncrement`, so EAS then manages the build number itself and ignores the one stamped; the
  version string still comes from `app.json`.
- The app shows its version in Settings, under About ("Financer 1.2.3 (build 1002003)"), read
  with expo-constants. The server's `/health` answer stays `ok` and there is no other place that
  reports the server version, so Settings shows only the app version.
- Try the stamping locally (this edits your files; revert with git): `cd apps/mobile && node
  scripts/set-version.mjs v1.2.3 --dry-run` prints what would change without writing, and from the
  repository root `.github/scripts/set-rust-version.sh v1.2.3`.

## Signing the Android app

By default the `android-apk` job signs the release APK with the debug key that `expo prebuild`
generates, which is fine to install on your own phone but not for the Play Store, and an APK signed
with a different key cannot be installed over one signed with another. If you add **all four**
secrets below, the job signs with your own keystore instead; if one is missing it says so in a
warning and keeps the debug key exactly as before.

1. Create a keystore once and **keep it and its passwords safe**. If you lose it you cannot publish
   updates under the same identity:
   ```
   keytool -genkeypair -v -storetype PKCS12 -keystore financer-release.keystore \
     -alias financer -keyalg RSA -keysize 2048 -validity 10000
   ```
   (You are asked for the passwords and your name; with PKCS12 the key password equals the store password.)
2. Encode it as one line: `base64 -w0 financer-release.keystore` (macOS: `base64 -i financer-release.keystore`).
3. Add these repository secrets (Settings, Secrets and variables, Actions):

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | the base64 text from step 2 |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | the alias (`financer` above) |
   | `ANDROID_KEY_PASSWORD` | the key password |

4. Keep the keystore file outside the repository and never commit it.

How it works: the `android/` project is generated on every build, so it is not edited by hand. The
job decodes the keystore into the runner's temp directory and runs Gradle with the init script
`.github/scripts/android-signing.init.gradle`. The script reads the keystore from environment
variables and, once the app's own `build.gradle` has been evaluated, replaces the signing config of
the `release` build type. Afterwards the job runs `apksigner verify --print-certs` on the APK and
fails if it is still signed with the debug key although the secrets are set.

**This signing path has not been run.** Only the parts that do not need an Android build were
checked: the workflow passes `actionlint`, and the init script loads and is inert in a plain Gradle
build. Whether the Android Gradle plugin of the generated project accepts it (the `finalizeDsl`
hook), and whether the verification step finds `apksigner` on the runner, is unproven until the
first run with real secrets; read that job's log the first time.

## Dependency updates and nightly checks

- `.github/dependabot.yml` opens weekly update pull requests for the Rust workspace (cargo), the app
  (`apps/mobile`) and `apps/embedded-bindings` (npm) and the GitHub Actions used by the workflows.
  Minor and patch updates of each are grouped into one pull request; open pull requests are limited
  (5, 5, 3, 3). For the app, major updates of `expo` and any React / React Native update are
  ignored, because Expo fixes those per SDK release: upgrade the SDK by hand (`npx expo install --fix`).
- `.github/workflows/nightly.yml` runs every night (03:17 UTC) and on demand: `cargo test
  --workspace` (with the Postgres service the normal tests use), then `cargo audit` and
  `npm audit --omit=dev` for `apps/mobile`. The two audits only **report**: their steps never fail
  the run, and the output is in the run's summary. A failing test run does turn it red.
  `apps/embedded-bindings` has no lock file, so it is not audited.
- Neither file has run on GitHub yet; both pass `actionlint` / parse as YAML, nothing more is proven.

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
- Version stamping: the pure parts and the command line of `set-version.mjs` have unit tests
  (`npm test` in `apps/mobile`), and `set-rust-version.sh` was run on a copy of the workspace and
  followed by `cargo metadata --locked`, which accepts the changed `Cargo.lock`. The workflow steps
  that call them (tag check, local commit for EAS) have **not run on GitHub**.
- Android release signing, Dependabot and the nightly workflow have **not run** (see above).
