import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  defaultCategoriesFromSchema,
  isLocalHost,
  parseSeedArgs,
} from "../../scripts/seed-args.mjs";

const creds = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "k" };
const remote = { SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };

describe("seed-demo safety flags", () => {
  it("needs Supabase env", () => {
    expect(parseSeedArgs([], {}).ok).toBe(false);
  });
  it("seeds a local database freely", () => {
    const r = parseSeedArgs(["--reset"], creds);
    expect(r).toMatchObject({ ok: true, reset: true, allowRemote: false, host: "127.0.0.1" });
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("[::1]")).toBe(true);
  });
  it("refuses a remote database without --allow-remote", () => {
    const r = parseSeedArgs(["--reset"], { ...remote, DEMO_RESET_CONFIRM: "yes" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--allow-remote/);
  });
  it("refuses a remote database without DEMO_RESET_CONFIRM=yes", () => {
    for (const confirm of [undefined, "", "true", "YES"]) {
      const r = parseSeedArgs(["--reset", "--allow-remote"], {
        ...remote,
        DEMO_RESET_CONFIRM: confirm,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/DEMO_RESET_CONFIRM=yes/);
    }
  });
  it("allows a remote reset only with both safeguards", () => {
    const r = parseSeedArgs(["--reset", "--allow-remote"], {
      ...remote,
      DEMO_RESET_CONFIRM: "yes",
    });
    expect(r).toMatchObject({ ok: true, reset: true, allowRemote: true, host: "abc.supabase.co" });
  });
  it("rejects unknown arguments and bad URLs", () => {
    expect(parseSeedArgs(["--rest"], creds).ok).toBe(false);
    expect(parseSeedArgs([], { ...creds, SUPABASE_URL: "not a url" }).ok).toBe(false);
  });
});

describe("default categories for reset", () => {
  it("reads every seeded category from schema.sql", () => {
    const cats = defaultCategoriesFromSchema(
      readFileSync(`${process.cwd()}/supabase/schema.sql`, "utf8"),
    );
    const keys = cats.map((c) => `${c.name}|${c.kind}`);
    expect(keys).toContain("Gaji|income");
    expect(keys).toContain("Piutang|expense");
    expect(keys).toContain("Biaya Admin|expense");
    expect(keys).toContain("Emas|income");
    expect(new Set(keys).size).toBe(keys.length);
  });
});
