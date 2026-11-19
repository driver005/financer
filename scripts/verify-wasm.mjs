/**
 * Reproducibility check for the generated WASM core.
 *
 * Generated WASM bytes depend on the local toolchain (rustc / wasm-bindgen /
 * wasm-opt), so comparing bytes against a different machine's commit is not
 * reproducible. Instead this verifies the two things that actually matter:
 *   1. wasmBytes.ts is the exact base64 of pantry_bg.wasm (the app embeds it).
 *   2. Re-running the generator in THIS environment produces identical bytes.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const wasmPath = `${root}apps/mobile/src/rust/pantry_bg.wasm`;
const bytesPath = `${root}apps/mobile/src/rust/wasmBytes.ts`;

const wasm = readFileSync(wasmPath);
const embedded = readFileSync(bytesPath, "utf8").match(/WASM_BASE64 = "([^"]+)"/)?.[1];
if (!embedded) throw new Error("wasmBytes.ts has no WASM_BASE64 payload");
if (Buffer.from(embedded, "base64").compare(wasm) !== 0) {
  throw new Error("wasmBytes.ts does not match pantry_bg.wasm — run `make core-build`");
}

const hash = (data) => createHash("sha256").update(data).digest("hex");
const before = hash(wasm);
execFileSync("make", ["core-build"], { cwd: root, stdio: "ignore" });
const after = hash(readFileSync(wasmPath));
if (before !== after) throw new Error(`WASM build is not reproducible in this environment: ${before} != ${after}`);

console.log(`WASM verified: ${wasm.length} bytes, sha256 ${after}, reproducible.`);
