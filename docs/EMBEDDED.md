# Running the backend on the phone (embedded mode)

The hosted server and the phone run the **same Rust code**. In embedded mode the app calls
`crates/embedded` in-process: there is no listening port, so nothing else on the phone can
reach it, and your data stays in the app's private storage (SQLite).

## Status: what is verified and what is not

| Part | State |
|---|---|
| `crates/embedded` (start, in-process request handling, persistence, malformed input) | built and tested on the host (6 tests) |
| UniFFI interface (`Backend.start`, `handle`, `refreshPrices`) | Kotlin and Swift bindings generate from the built library (checked in CI) |
| App transport (`EmbeddedTransport`), settings, mode switch, backup export/import | tested in Node and in the browser build (the mode reports "not available in this build") |
| Cross-compiling `crates/embedded` | **Android and iOS both pass** on GitHub runners (`.github/workflows/native.yml`): Android with a real NDK (arm64 phones and the x86_64 emulator), iOS with Xcode (iPhone and simulator). iOS first failed at link time (the C code in the TLS libraries was built for a newer iOS than Rust links for); pinning `IPHONEOS_DEPLOYMENT_TARGET=15.0` fixed it. Only the Rust library is built, not the app |
| The UniFFI React Native module (`uniffi-bindgen-react-native` 0.31.0-6, flavour `jsi2`) and an Android app that includes it | **builds in CI**: the `android-app` job in `native.yml` runs Rust -> bindings -> typecheck of the app against the generated TypeScript -> `expo prebuild` -> Gradle `assembleRelease` and uploads the APK. The typecheck caught one real mismatch (`contentType` is optional in the generated types), now fixed. The iOS app with the module also **builds in CI** (`ios-app` job: Rust -> bindings -> `expo prebuild` -> CocoaPods -> `xcodebuild` for arm64 simulators, unsigned). It needed two fixes: `author`/`homepage` in the bindings package for the pod spec, and `ARCHS=arm64` because the library has no x86_64 simulator slice. **Never run**: there is no iOS equivalent of the emulator check |
| Running that app | **runs on an Android emulator in CI** (`android-emulator` job, API 33 x86_64): the app starts the Rust backend, imports one CSV transaction through it and reads it back categorised (`FINANCER_SMOKE OK health=200:ok import=200 category=groceries`, from `apps/mobile/scripts/smoke-entry.js`). The first attempt crashed with `libfinancer_embedded.so not found` because `npm install --install-links` honoured `.gitignore` and dropped the generated native module; a `.npmignore` fixed it. **Not a physical phone**: the arm64 build, the screens in embedded mode, the SQLite file surviving an app restart, background refresh and real network calls (prices, FinTS, LLM) have not been exercised |
| Receipt import from Lidl Plus on the phone (`StartConfig.lidlPlus`, `Backend.syncReceiptsNow`) | the Rust side is tested natively (switch on, sign-in page address, "nothing due" without a sign-in, refusal without a device secret) and the crate cross-compiles for Android and iOS in CI; **never run on a device, never against Lidl** (see "Receipts from Lidl Plus on the phone") |
| Background price refresh (`expo-background-task`, registered when the on-phone backend starts; also refreshes on app open) | written, typechecks and bundles; **never run on a device** |

So the Rust half and the app half are in place and tested, the library cross-compiles for Android
and iOS, and an Android APK that contains it builds on a GitHub runner and answers requests on an
emulator; the iOS app builds for the simulator. What is left is a physical Android phone, and running
anything on iOS (which you will have to try and debug).

## Limits you cannot code around

- **iOS suspends apps.** The backend runs only while the app is open, plus whatever short
  windows iOS grants a background task (it decides when; per Expo's `expo-background-task`
  docs there is no guaranteed interval). A phone cannot be an always-on server on iOS.
- **Android** can keep it alive with a foreground service (visible notification) and
  WorkManager background tasks (15 minute minimum interval).
- Because of that, scheduled price refresh in embedded mode means "when you open the app and
  when the OS lets us"; the hosted server refreshes daily on its own.
- API keys (Claude, OpenAI), the FinTS product id and the price sources are entered in the
  app and kept in the phone's secure storage, because there is no server to hold them.

## Receipts from Lidl Plus on the phone

The phone has no `financer.toml`, so the receipt sources are not configured by a file here:

- **Lidl Plus** is a switch in the app (Receipt sources > Lidl Plus > "Switch on Lidl Plus"). It is
  saved with the other on-phone settings (`EmbeddedSettings.lidlPlus`) and restarts the backend.
  You then sign in on Lidl's own page, exactly as with a server; the app hands the one-time code to
  the on-phone backend, which keeps only a refresh token.
- **The token is encrypted** with a random secret that the app creates once
  (`generate_device_secret`) and keeps in the phone's secure storage (`financer.device-secret`),
  not in the database file. A phone backup that contains only the database therefore does not
  contain a usable Lidl sign-in. The secret must not change: with another one the stored sign-in
  cannot be opened and you sign in again.
- **When it syncs:** `Backend.syncReceiptsNow()` runs when the app opens and from the OS background
  task, right after the price refresh. It does nothing until you have signed in, and only when the
  poll interval (12 hours) has passed. Not always-on: the OS decides when background work runs, and
  on iOS that is often only overnight.
- **Email and the watched folder are not available on the phone.** Reading a mailbox needs a
  process that can stay connected, and the app cannot watch a folder; both stay server-only. The
  screen says so instead of describing server settings.
- Everything is as unofficial and untested against the real service as the server version (see
  RECEIPT_SOURCES.md).

## Building it

The committed app has no native code, so it runs in Expo Go and on the web. The backend is an
opt-in build step:

```sh
cd apps/mobile
scripts/enable-embedded.sh android     # needs cargo-ndk and the Android NDK; "ios" needs Xcode
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

The script builds `crates/embedded` for the phone, generates the bindings in
`apps/embedded-bindings` (config: `ubrn.config.yaml`; everything generated is gitignored),
installs them together with `@ubjs/react-native` and `@ubjs/core` as **direct** app dependencies
(autolinking reads only the app's own `package.json`) and rewrites
`apps/mobile/modules/financer-embedded/index.ts` to re-export the generated `Backend`. It changes
your working copy, so use a throwaway checkout or `git checkout` the changes afterwards. The
generated names match what `apps/mobile/src/native/embedded.ts` expects.

`uniffi-bindgen-react-native` must stay on **0.31.x**: it pins UniFFI to exactly `0.31`, which
is why `crates/embedded` depends on `uniffi = "=0.31"`. Expo Go cannot load native code, so use a
development build or the APK.

If this does not work out on a device, the fallback is the official UniFFI Kotlin and Swift
bindings wrapped in an Expo Module; the Rust crate does not change.

## Check the bindings generate

```sh
cargo build -p financer-embedded --features bindgen-cli
cargo run -p financer-embedded --features bindgen-cli --bin uniffi-bindgen -- \
  generate --library target/debug/libfinancer_embedded.so --language kotlin --out-dir /tmp/bindings
```

(`.dylib` on macOS.) CI runs this for Kotlin and Swift.

## Moving data between server and phone

**Settings → Your data → Export** writes one JSON file (transactions, budget, usual items,
receipts, non-secret settings; never PINs, tokens, API keys or prices). **Import** merges such
a file into the current backend: transactions and receipts already present are skipped, so
importing twice changes nothing. Switch the mode, then import the file to carry your data over.
The two modes keep separate databases otherwise.
