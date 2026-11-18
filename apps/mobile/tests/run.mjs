import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../.test-build/tests/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".test.js")).map((f) => `${dir}${f}`);
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
