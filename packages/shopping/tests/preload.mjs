// Loaded before every test file (node --import): the Rust SDK as WebAssembly, so the shopping logic that
// moved to Rust (crates/logic) can be called from the TypeScript tests that use it. The bindings are
// the ones scripts/enable-sdk.sh web makes; tsc compiles them with the tests (tests/tsconfig.json).
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const build = new URL("../.test-build/", import.meta.url);
const bindings = require(fileURLToPath(new URL("apps/sdk-bindings/src/generated-web/index.js", build)));
const { setLogic } = require(fileURLToPath(new URL("packages/wire/src/logic.js", build)));

await bindings.uniffiInitAsync(fileURLToPath(new URL("../../../apps/sdk-bindings/src/generated-web/financer_sdk.wasm", import.meta.url)));
setLogic(bindings.logic);
