# The Rust SDK

A Rust client for the Financer server's APIs (`crates/sdk`), and the way the Expo app uses it: the app
calls Rust functions, in the browser as WebAssembly and on a phone as a native module. There are two ways in:

- **Typed calls**: `MailSdk` has one Rust function per call of the mail API, with the server's own types.
- **The generic client**: `ApiClient` takes a request (method, path, bytes) and returns the answer (status,
  bytes). The **finance app and the shopping assistant send all their traffic through it** when the build
  has the SDK: network, TLS and the token are handled in Rust, and their typed TypeScript wrappers decide
  what to ask and read the answer. Typed Rust calls for them come next (see [What is done](#what-is-done)).

## Why

- **One definition of every type.** The request and response types of the mail API live in
  `crates/mail-core/src/wire.rs` and are used by the server that writes them *and* by the SDK that reads
  them. The SDK re-declares them for UniFFI field by field, so a change to the API that the SDK does not
  follow does not compile. Before, the TypeScript types were copied by hand and could drift.
- **Rust logic on the device** later (grouping, quote stripping, templates already live in `mail-core`
  and compile for the phone and the browser).
- **A client for Rust** (tests, tools, other services): the SDK's own tests drive the real server
  router through it.

## How it is built

```
crates/mail-core   wire types (serde), pure logic            -> native, wasm32
crates/sdk         Transport trait, HttpTransport, MailSdk   -> native, wasm32; UniFFI exports
apps/sdk-bindings  ubrn config: generates the TypeScript     -> src/generated (phone), src/generated-web (browser)
packages/mail      SdkMailClient: generated shapes -> the screens' shapes
apps/mobile        src/mail/rustSdk.{web,native}.ts, scripts/enable-sdk.sh
```

- **Transport.** The SDK builds requests and reads answers; a `Transport` only carries bytes.
  `HttpTransport` (reqwest) goes over the network and, in the browser, through `fetch`. The tests, and the
  phone that runs the backend inside the app ([EMBEDDED.md](EMBEDDED.md)), can pass one that calls the
  server's router in the same process.
- **Bindings.** [uniffi-bindgen-react-native](https://github.com/jhugman/uniffi-bindgen-react-native)
  (the tool the embedded backend already uses) generates TypeScript from the crate: `jsi2` for phones,
  `wasm2` for the browser.
- **The screens do not change.** The generated TypeScript speaks camelCase, `bigint`, numeric enums and
  absent optionals; `packages/mail/src/api/sdk.ts` translates to the shapes the screens read, in both
  directions (tested with a fake that has the generated module's exact shapes).
- **Fallback.** The app picks the Rust SDK when the build has it, and uses the TypeScript client
  (`MailClient`, plain `fetch`) when it does not, or when the SDK cannot be loaded. The Mailbox screen says
  which one is in use.

## Why the web build does not have to fail

A native JSI module cannot run in a browser, and `wasm2` cannot run under Hermes (React Native's engine
has no WebAssembly). So the same crate is built twice: a native library for phones, a `.wasm` for the
browser. `ubrn build wasm2` needs one `cargo build --target wasm32-unknown-unknown` (860 KB with
`--release`) and generates the TypeScript from the module; the crate needs only `uniffi`'s
`wasm-unstable-single-threaded` feature (the browser runs futures on one thread) and the player crate
`uniffi-runtime-wasm`. The crate must stay free of anything that cannot compile for the browser, which is
why it is separate from `crates/embedded` (SQLite, the server), and CI builds it for `wasm32` on every push.

What does **not** work: **Expo Go** (it cannot load custom native modules) and any native build made
without `scripts/enable-sdk.sh`. They use the TypeScript client, as before.

## Use it

```sh
cd apps/mobile
scripts/enable-sdk.sh web                         # builds the .wasm and its TypeScript
EXPO_PUBLIC_RUST_SDK=1 npx expo export --platform web --output-dir dist     # or `npx expo start --web`

scripts/enable-sdk.sh android                     # needs cargo-ndk and the Android NDK; then a custom build
scripts/enable-sdk.sh ios                         # needs Xcode
```

`make`/`npm start` without `EXPO_PUBLIC_RUST_SDK=1` is the app it always was. The web script needs
`wasm-bindgen-cli` in the version `Cargo.lock` resolves (the script installs it).

## What is done

| Part | State |
|---|---|
| Wire types of the mail API in `mail-core`, used by server and SDK | done; the server's 27 end-to-end tests pass unchanged |
| `crates/sdk` with all 16 mail calls, HTTP and swappable transports, errors with the server's reasons | done; tested against the real router (7 tests) and a real socket (the bearer token is sent, never shown in an error) |
| Builds for WebAssembly | done; `cargo clippy --target wasm32-unknown-unknown` clean, built with `ubrn build wasm2 --release` |
| The web app calling Rust | done and **driven in a real browser** against the real server: the module loads (HTTP 200), the Mailbox screen reports the Rust SDK, chats, a chat, the greeting/closing preview, a send (refused by the missing mail server, as expected), the calendar, all through Rust |
| Adapter between the generated and the screens' shapes | done; 11 Node tests with a fake of the generated shapes, plus the browser run above |
| Native (JSI) build for Android and iOS | **written, never built or run**: `scripts/enable-sdk.sh android\|ios` and `rustSdk.native.ts` follow the embedded backend's setup, but this needs the NDK or Xcode (CI has a job to add) |
| `ApiClient`, the generic client: bytes in, status and bytes out, a refusal is an answer, only not reaching the server is an error | done; tested against the real finance router (with mail mounted beside it), and over a real socket (token sent, `/health` open, no token in an error) |
| The finance app and the shopping assistant sending everything through Rust | done and **driven in a real browser**: with the SDK on, all 9 requests of the Today screen, the shopping assistant's and mail's came from WebAssembly and none from JavaScript (seen by wrapping `fetch` and reading each call's stack). The first load waits for the module, so nothing is asked twice |
| Typed Rust calls for the finance API | **done in Rust**: `crates/sdk/gen/finance.mjs` writes `src/finance.rs` from `apps/mobile/openapi.json`: 114 records and enums and 67 typed async calls (`FinanceSdk`), with a CI check that the file is current (and the existing check that `openapi.json` is what the server says). Tested against the real finance router (6 tests, every operation and schema of the document must exist); builds for wasm32; UniFFI generates a 13,000-line typed TypeScript binding from it. **Not yet used by the app** (see below) |
| Typed Rust calls for the shopping API | **not done** (no OpenAPI file; its wire types would move out of `shop-api` into a light crate like mail's, and the untagged attribute value needs a UniFFI custom type) |
| Removing the TypeScript clients | **not done, on purpose**: the typed wrappers of finance and shopping are still how those apps decide what to ask, and Expo Go, the standalone shopping app, the catalog and the tests need the TypeScript transports. What can go once every build has the SDK: `RemoteTransport`, `RemoteShopTransport` and the mail HTTP client; what can go once typed calls exist: the wrappers |

### Why the finance screens do not call `FinanceSdk` yet

The generated TypeScript speaks camelCase, `bigint` and numeric enums; the 48 files that use the finance API
read snake_case, plain numbers and words (the types of `schema.d.ts`). Two ways to close that gap:

- an adapter like mail's (`SdkMailClient`), one thin method per call of the existing `Api` class: the screens
  stay as they are, but the TypeScript wrapper layer stays too (smaller: no HTTP, no URLs, no types of its own);
- change the screens to read the generated types directly: the only way the TypeScript API types
  (`schema.d.ts`, the `Api` class) can really go, and a rewrite of those 48 files and their tests.

Either is a step of its own; the generic client already carries all their traffic in Rust.

### The rest of the plan

0. (done) the generic client for finance and shopping, so all three apps do their server I/O in Rust.
1. A CI job for the native build of `crates/sdk` (the existing `android-app` / `ios-app` jobs are the pattern),
   so the JSI path is proven, and the generated native types checked against `MailSdkLike`.
2. **Typed shopping calls**: move its wire types (`shop-core`, rich: tagged enums, untagged attribute values, maps) into a
   light crate the SDK can use; the attribute values need a UniFFI custom type (a JSON string) because UniFFI
   has no untagged unions.
3. **Typed finance calls**: the DTOs live in `crates/api` with the OpenAPI schemas; they move to a light types crate the
   same way, the generated `schema.d.ts` goes away.
4. Remove the TypeScript clients and transports once every shipped build has the SDK.

Steps 2 and 3 are the bulk of the work (about 100 types and 100 endpoints), and each ends with the same checks as
mail: the SDK against the real router, then the browser against the real server.
