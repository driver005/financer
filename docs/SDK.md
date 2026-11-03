# The Rust SDK

The Expo apps talk to a server only through Rust (`crates/sdk`): in the browser as WebAssembly, on a phone as a
native module. There is no TypeScript HTTP client any more.

```
screens (TSX)  ->  Api / ShopClient / MailClient   a call by name, values by name
                        |
                   packages/wire                   bind(wire, app): JSON in, JSON text out, refusals -> errors
                        |
                   Wire (Rust, UniFFI)             dispatch(app, op, args) -> the typed calls
                        |
                   FinanceSdk / ShopSdk / MailSdk  one typed async fn per call: path, verb, encoding, checking
                        |
                   Transport                       HttpTransport (reqwest / fetch), or the server's router in process
```

## What is in Rust, what is not

In Rust: which path and verb a call uses, how values are encoded (path escapes, query strings, base64 for an
upload), the request and response records, whether the server's answer is what the SDK expects (it is decoded
into the records before the app sees it), how a refusal is read (status, the server's words, one entry per
problem), the network, TLS and the bearer token.

The answer the app gets is **the server's own JSON text**, so the screens read `snake_case`, plain numbers and
`null` exactly as before; the records are the contract that text is checked against, not a second shape to
convert to. What stays in TypeScript is what has to be: the screens, and the glue to device APIs (files,
notifications, biometrics, background tasks).

## The three typed layers

| App | Typed calls | Source |
|---|---|---|
| finance | `FinanceSdk`: 77 calls, 123 records and enums | **generated** from `apps/mobile/openapi.json` by `crates/sdk/gen/finance.mjs`; CI checks the file is current, and that the OpenAPI file is what the server says |
| shopping | `ShopSdk`: 31 calls | hand-written in `crates/sdk/src/shop.rs`; tested by driving every call against the real shop router. Open values (an attribute, a criterion) are JSON |
| mail | `MailSdk`: 16 calls | `crates/sdk/src/mail.rs`; its types are `mail-core`'s own wire types, shared with the server |

`Wire.call(app, op, args)` dispatches by name: `args` is a JSON object holding path and query values by name,
the request body as `body`, and an upload as `csv_base64`. `app.op` inside one app (`shop.categories` from the
finance client) reaches another app of the same server.

## Transports

- **A server**: `Wire.new(baseUrl, token)` uses `HttpTransport` (reqwest natively, `fetch` in the browser).
- **The backend inside the app** ([EMBEDDED.md](EMBEDDED.md)): `financer-embedded` depends on this crate and
  gives `Backend.call` / `ShopBackend.call`, which run the same typed calls over the in-process router. The app
  uses one code path for both.
- **Tests**: the SDK's tests pass the server's router as the transport (no sockets), and one test uses a real
  socket to check the token is sent and never shown in an error.

## Building

```
crates/mail-core   wire types (serde), pure logic              -> native, wasm32
crates/sdk         Transport, the typed calls, Wire            -> native, wasm32; UniFFI exports
apps/sdk-bindings  ubrn config: generates the TypeScript       -> src/generated (phone), src/generated-web (browser)
packages/wire      the TypeScript side of Wire (no logic)      + the platform loaders rustSdk.{web,native}.ts
```

[uniffi-bindgen-react-native](https://github.com/jhugman/uniffi-bindgen-react-native) generates the TypeScript:
`jsi2` for phones, `wasm2` for the browser. The same crate is built twice because a native JSI module cannot
run in a browser and Hermes has no WebAssembly. The crate must stay free of anything that cannot compile for
the browser, which is why it is separate from `crates/embedded` (SQLite); CI builds it for `wasm32` on every push.

```sh
apps/mobile/scripts/enable-sdk.sh web                 # builds the .wasm and its TypeScript
apps/mobile/scripts/enable-sdk.sh web ../shopping     # the same for the standalone shopping app
apps/mobile/scripts/enable-sdk.sh android             # needs cargo-ndk and the Android NDK; then a development build
apps/mobile/scripts/enable-sdk.sh ios                 # needs Xcode
```

**Every build needs the SDK.** Expo Go cannot load a native module, so a phone needs a development build. A build
without the bindings does not bundle (Metro cannot resolve the module); an environment that loads the app
without them (plain Node) gets a message saying so (`NO_SDK`) when it first reaches for a server. The web script
needs `wasm-bindgen-cli` in the version `Cargo.lock` resolves (the script installs it).

## What is done

| Part | State |
|---|---|
| Typed calls: finance (generated), shopping, mail | done; 77 + 31 + 16 calls, each tested against the real router |
| `Wire` and `dispatch` for all three apps, CSV upload as base64, nulls and numbers as the server wrote them | done; tested against the real routers (SDK) and the in-process routers (embedded) |
| The TypeScript clients (`Api`, `ShopClient`, `MailClient`) | now one-line calls by name; the HTTP transports, the mail adapter and the generic byte client's TypeScript side are gone |
| Embedded backends answering the same calls | done in Rust, tested (finance and shop) |
| Web: the app calling Rust | see the run in the pull request; CI bundles the finance app (with and without the shop) and the standalone shopping app with the `.wasm` |
| Native (JSI) build for Android and iOS | **written, never built or run** (needs the NDK or Xcode; no job yet) |

Still in TypeScript, on purpose: the declaration-only types of the finance API (`schema.d.ts`, generated from
the OpenAPI file by `openapi-typescript`), the shopping and mail type declarations, and the screens. They carry
no logic. The app logic that the screens call (budget periods, game, forecast, notification planning, …) is
being moved to Rust one module at a time; see [LOGIC.md](LOGIC.md).
