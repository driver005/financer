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
| Cross-compiling to Android/iOS, the native module, running on a device | **not done**: needs the Android NDK or Xcode, which this project's development environment did not have |
| Background refresh | **not done** (see limits below) |

So the Rust half and the app half are in place and tested; the native build in the middle is
the part you will have to run and debug on your machine.

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

1. Install the Rust targets and the platform toolchains: Android NDK (`cargo-ndk` or the
   `uniffi-bindgen-react-native` Android build) and/or Xcode.
2. Use `uniffi-bindgen-react-native` **0.31.x**: it pins UniFFI to exactly `0.31`, which is why
   `crates/embedded` depends on `uniffi = "=0.31"`.
3. Point it at `crates/embedded`; it generates the TypeScript, the C++ glue and a React Native
   module. Put the generated module in `apps/mobile/modules/financer-embedded/`, replacing the
   placeholder `index.ts` there. The placeholder's shape is what the app expects:
   `Backend.start(config)` returning an object with `handle(request)` and `refreshPrices()`.
4. If the generated names differ (UniFFI maps Rust names to the target language's style), adapt
   `apps/mobile/src/native/embedded.ts`; it is the only file that knows them.
5. Make a custom development build (`expo prebuild` / EAS). Expo Go cannot load native code.

If `uniffi-bindgen-react-native` does not work out, the fallback is the official UniFFI
Kotlin and Swift bindings wrapped in an Expo Module; the Rust crate does not change.

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
