// Runs the tests with the Rust SDK loaded in every test process (the runner starts one per file and
// does not pass --import on, so it goes through NODE_OPTIONS). Needs the bindings:
// apps/mobile/scripts/enable-sdk.sh web
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const preload = fileURLToPath(new URL("./preload.mjs", import.meta.url));
const res = spawnSync(process.execPath, ["--test", ".test-build/packages/mail/tests/*.test.js"], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${preload}`.trim() },
});
process.exit(res.status ?? 1);
