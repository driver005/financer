# API style

One style for every call, so that an app, an SDK or a script can learn the API once. The rules
that can be checked are checked: `crates/api/tests/api_style.rs` reads the OpenAPI document and
fails the build when a call breaks one.

## Paths and names

- `/v1/<resource>`: lower-case, kebab-case, nouns. An id is a path parameter in `snake_case`
  (`/v1/rules/{id}`). Only `/health` lives outside `/v1`.
- JSON fields and query parameters are `snake_case`. Money is whole cents (`..._cents`), a day is
  `YYYY-MM-DD`.
- **The day an answer is for is always `date`** (never `as_of`, `day`, `today`). Absent means today.
- A **provider is a path parameter, never a path**: `/v1/bank/import/{kind}`,
  `/v1/receipts/sources/{kind}/connect`. A new provider adds a value of `kind`, not routes, and
  not schema names (`LidlStatusDto` would be wrong; `ReceiptSourceDto` is right).

## Verbs and statuses

| call | success |
| --- | --- |
| `GET` a list | `200`, a bare array of named objects |
| `GET` one thing | `200`, the object |
| `POST` that creates | `201`, the created object |
| `PUT` | `200`, the stored object |
| `DELETE` | `204`, no body (and nothing else answers `204`) |
| `POST` that does something (`.../sync`, `.../cancel`, `.../apply`) | `200`, the result or the new state |

Bodies are named schemas (`...Input` or `...Request` going in, `...Dto` coming out) or a file
(`text/csv`). No anonymous inline objects: they cannot be generated into a client.

## Errors

Every error is `{"error": "text"}` (`ErrorBody`), and it may add fields (`problems: [...]` when a
change was refused for several reasons). The text never holds a key, token, password or PIN.

| status | meaning |
| --- | --- |
| `400` | the input is wrong (including a change the server refuses; there is no `422`) |
| `401` | missing or wrong token |
| `404` | unknown id, name or kind |
| `409` | right input, wrong moment (already running, a lock by an environment variable) |
| `429` | too many tries, wait |
| `502` | the service behind the server (a bank, a shop) failed |
| `503` | not set up on this server (keys, a product id), the text says where |

## Providers: one family per kind of source

A source of data has a **flow**, which is all a client needs to know, and one family of calls:

- **Banks**, `/v1/bank/...`: `providers`, `connections`, `sync`, `sync/{id}`, `sync/{id}/cancel`,
  `import/{kind}`, `connections/{name}/disconnect`. Flows: `file`, `approval`, `link`. See
  `docs/BANK_PROVIDERS.md`.
- **Receipt sources**, `/v1/receipts/sources/...`: `GET sources`, `GET sources/{kind}`, then
  `connect`, `finish`, `disconnect`, `known`, `import` under `sources/{kind}/`, and
  `POST /v1/receipts/sync`. Flows: `server` (mailbox, folder), `sign_in` (Lidl Plus, Kaufland Card),
  `push` (REWE in the app, an orders file). See `docs/RECEIPT_SOURCES.md`.

## Adding a call

1. Follow the table above; reuse a named schema when the shape is the same.
2. Add it to the `paths(...)` and `schemas(...)` lists in `crates/api/src/lib.rs`.
3. `cargo test -p financer-api --test api_style` says what is wrong, if anything.
4. `cd apps/mobile && npm run gen:api` regenerates `openapi.json` and the TypeScript types.
