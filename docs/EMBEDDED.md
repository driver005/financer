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
| The UniFFI React Native module (`uniffi-bindgen-react-native` 0.31.0-6, flavour `jsi2`) and an Android app that includes it | **builds in CI**: the `android-app` job in `native.yml` runs Rust -> bindings -> typecheck of the app against the generated TypeScript -> `expo prebuild` -> Gradle `assembleRelease` and uploads the APK. The typecheck caught one real mismatch (`contentType` is optional in the generated types), now fixed. iOS app build with the module: **not tried** |
| Running that app on a device or emulator | **not done**: nothing has ever started the library, so whether `Backend.start` works at run time is unknown |
| Background price refresh (`expo-background-task`, registered when the on-phone backend starts; also refreshes on app open) | written, typechecks and bundles; **never run on a device** |

So the Rust half and the app half are in place and tested, the library cross-compiles for Android
and iOS, and an Android APK that contains it builds on a GitHub runner. What is left is running it
on a device or emulator (which you will have to do and debug), and the iOS app build.

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
