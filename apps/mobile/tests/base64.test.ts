import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toBase64 } from "../src/native/base64";

const bytes = (...n: number[]) => new Uint8Array(n).buffer as ArrayBuffer;

describe("toBase64", () => {
  it("matches the standard encoding for every padding length", () => {
    assert.equal(toBase64(bytes()), "");
    assert.equal(toBase64(bytes(0x41)), "QQ==");
    assert.equal(toBase64(bytes(0x41, 0x42)), "QUI=");
    assert.equal(toBase64(bytes(0x41, 0x42, 0x43)), "QUJD");
    assert.equal(toBase64(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34)), "JVBERi0xLjQ=");
  });

  it("agrees with Node's Buffer on random data", () => {
    for (let len = 0; len < 40; len++) {
      const data = new Uint8Array(len).map((_, i) => (i * 37 + len * 11) % 256);
      assert.equal(toBase64(data.buffer as ArrayBuffer), Buffer.from(data).toString("base64"), `length ${len}`);
    }
  });

  it("handles high bytes", () => {
    assert.equal(toBase64(bytes(0xff, 0xfe, 0xfd)), "//79");
  });
});
