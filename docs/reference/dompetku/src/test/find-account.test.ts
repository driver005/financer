/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed in-memory DB fakes */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Tiny PostgREST-like fake whose ILIKE honours `\` escapes, so wildcard escaping is actually exercised. */
type Row = any;
const tables: Record<string, Row[]> = {};
const calls: { table: string; pattern: string }[] = [];
function ilike(v: unknown, pattern: string) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\" && i + 1 < pattern.length)
      re += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is").test(String(v ?? ""));
}
function q(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let insert: Row | null = null;
  const api: any = {
    select: () => api,
    eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), api),
    ilike: (k: string, p: string) => (
      calls.push({ table, pattern: p }),
      filters.push((r) => ilike(r[k], p)),
      api
    ),
    insert: (v: Row) => ((insert = v), api),
    single: () => api,
    then: (res: (v: unknown) => void) => {
      const t = (tables[table] ??= []);
      if (insert) {
        const row = { id: `new-${t.length + 1}`, ...insert };
        t.push(row);
        return res({ data: row, error: null });
      }
      return res({ data: t.filter((r) => filters.every((f) => f(r))), error: null });
    },
  };
  return api;
}
vi.mock("../lib/db.server", () => ({ db: () => ({ from: q }) }));

import { ensureCategory, escapeLike, findAccount, pickBestNameMatch } from "../lib/finance.server";

const acc = (id: string, name: string) => ({ id, name });

describe("escapeLike", () => {
  it("escapes %, _ and backslash", () => {
    expect(escapeLike("50%_off\\x")).toBe("50\\%\\_off\\\\x");
    expect(escapeLike("Bank Jago")).toBe("Bank Jago");
  });
});

describe("pickBestNameMatch", () => {
  const rows = [acc("1", "Bank Jago"), acc("2", "Jago"), acc("3", "Jago Syariah"), acc("4", "BCA")];

  it("prefers the exact name over a longer one containing it, and vice versa", () => {
    expect(pickBestNameMatch(rows, "Jago")?.id).toBe("2");
    expect(pickBestNameMatch(rows, "Bank Jago")?.id).toBe("1");
    expect(pickBestNameMatch([...rows].reverse(), "Jago")?.id).toBe("2");
  });

  it("ignores case and extra whitespace", () => {
    expect(pickBestNameMatch(rows, "  jAGo ")?.id).toBe("2");
    expect(pickBestNameMatch(rows, "bank   JAGO")?.id).toBe("1");
    expect(pickBestNameMatch([acc("9", " Bank  Jago ")], "bank jago")?.id).toBe("9");
  });

  it("ranks partial matches: prefix, then word start, then shortest, deterministically", () => {
    const only = [acc("1", "Bank Jago"), acc("3", "Jago Syariah")];
    expect(pickBestNameMatch(only, "jag")?.id).toBe("3"); // prefix beats word match
    expect(
      pickBestNameMatch([acc("a", "Bank Jago Utama"), acc("b", "Bank Jago")], "jago")?.id,
    ).toBe("b"); // shortest
    expect(pickBestNameMatch([acc("a", "Mandiri"), acc("b", "Bank Mandiri")], "andiri")?.id).toBe(
      "a",
    ); // substring → shortest
    expect(
      pickBestNameMatch([acc("x", "Bank Mandiri"), acc("y", "Kartu Mandiri")], "mandiri")?.id,
    ).toBe("x"); // word, same length → by name
    expect(pickBestNameMatch([acc("z", "Dompet"), acc("y", "Dompet")], "dompet")?.id).toBe("y"); // tie → by id
  });

  it("treats wildcard characters literally", () => {
    const w = [
      acc("1", "Tabungan 100%"),
      acc("2", "Tabungan 1000"),
      acc("3", "e_wallet"),
      acc("4", "ewallet"),
    ];
    expect(pickBestNameMatch(w, "100%")?.id).toBe("1");
    expect(pickBestNameMatch(w, "e_wallet")?.id).toBe("3");
    expect(pickBestNameMatch(w, "%")?.id).toBe("1");
  });

  it("returns null for no match or empty query", () => {
    expect(pickBestNameMatch(rows, "Mandiri")).toBeNull();
    expect(pickBestNameMatch(rows, "   ")).toBeNull();
    expect(pickBestNameMatch(rows, null)).toBeNull();
    expect(pickBestNameMatch([], "Jago")).toBeNull();
  });
});

describe("findAccount", () => {
  beforeEach(() => {
    for (const k of Object.keys(tables)) delete tables[k];
    calls.length = 0;
    tables["accounts"] = [
      acc("bank", "Bank Jago"),
      acc("jago", "Jago"),
      acc("pct", "Tabungan 100%"),
      acc("p2", "Tabungan 1000"),
      acc("u", "e_wallet"),
      acc("u2", "eXwallet"),
    ];
  });

  it("resolves Jago and Bank Jago to the right accounts", async () => {
    expect(await findAccount("Jago")).toBe("jago");
    expect(await findAccount("bank jago")).toBe("bank");
    expect(await findAccount("  JAGO  ")).toBe("jago");
  });

  it("escapes wildcards in the partial query", async () => {
    expect(await findAccount("100%")).toBe("pct");
    expect(calls.at(-1)?.pattern).toBe("%100\\%%");
    expect(await findAccount("e_wallet")).toBe("u");
    expect(await findAccount("%")).toBe("pct");
  });

  it("returns null when nothing matches or input is empty", async () => {
    expect(await findAccount("Mandiri")).toBeNull();
    expect(await findAccount("")).toBeNull();
    expect(await findAccount(null)).toBeNull();
    expect(calls.length).toBe(1);
  });
});

describe("ensureCategory", () => {
  beforeEach(() => {
    for (const k of Object.keys(tables)) delete tables[k];
    tables["categories"] = [
      { id: "c1", name: "Makan_Minum", kind: "expense" },
      { id: "c2", name: "Biaya Admin", kind: "expense" },
    ];
  });

  it("matches exactly ignoring case/whitespace, without treating _ as a wildcard", async () => {
    expect(await ensureCategory("  biaya admin ", "expense")).toBe("c2");
    expect(await ensureCategory("makan_minum", "expense")).toBe("c1");
    const id = await ensureCategory("MakanXMinum", "expense");
    expect(id).not.toBe("c1");
    expect(tables["categories"]!.find((c) => c.id === id)?.name).toBe("MakanXMinum");
  });
});
