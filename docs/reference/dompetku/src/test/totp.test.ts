import { afterEach, describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  buildOtpauthUri,
  candidateSteps,
  counterBytes,
  formatSecret,
  isValidTotpSecret,
  normalizeTotpCode,
  totpStep,
} from "@/lib/totp";
import {
  generateTotpSecret,
  hotp,
  matchTotp,
  resetTotpReplay,
  totpAt,
  verifyLoginTotp,
} from "@/lib/totp.server";

// RFC 6238 appendix B seed "12345678901234567890" (SHA1) in base32.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32", () => {
  it("round-trips and matches RFC 4648 vectors", () => {
    const enc = (s: string) => base32Encode(new TextEncoder().encode(s));
    expect(enc("f")).toBe("MY");
    expect(enc("foobar")).toBe("MZXW6YTBOI");
    expect(new TextDecoder().decode(base32Decode("mzxw 6ytb-oi======")!)).toBe("foobar");
    expect(enc("12345678901234567890")).toBe(RFC_SECRET);
    expect(base32Decode("abc1")).toBeNull();
    expect(base32Decode("")).toBeNull();
  });

  it("validates secret length", () => {
    expect(isValidTotpSecret(RFC_SECRET)).toBe(true);
    expect(isValidTotpSecret("MZXW6YTBOI")).toBe(false);
    expect(isValidTotpSecret("not base32!")).toBe(false);
  });
});

describe("step math", () => {
  it("computes 30 s steps and big-endian counters", () => {
    expect(totpStep(59_000)).toBe(1);
    expect(totpStep(1111111109_000)).toBe(0x23523ec);
    expect(Array.from(counterBytes(0x23523ec))).toEqual([0, 0, 0, 0, 2, 0x35, 0x23, 0xec]);
    expect(Array.from(counterBytes(20000000000 / 30))).toEqual([
      0, 0, 0, 0, 0x27, 0xbc, 0x86, 0xaa,
    ]);
  });

  it("lists window candidates, current first, never negative", () => {
    expect(candidateSteps(10)).toEqual([10, 9, 11]);
    expect(candidateSteps(0)).toEqual([0, 1]);
  });

  it("normalizes user codes", () => {
    expect(normalizeTotpCode(" 123 456 ")).toBe("123456");
    expect(normalizeTotpCode("12345")).toBeNull();
    expect(normalizeTotpCode("12a456")).toBeNull();
  });
});

describe("RFC 6238 SHA1 vectors", () => {
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  it.each(vectors)("t=%i → %s", (t, code) => {
    expect(totpAt(RFC_SECRET, t * 1000, 8)).toBe(code);
  });

  it("matches RFC 4226 HOTP vectors", () => {
    const key = new TextEncoder().encode("12345678901234567890");
    expect(hotp(key, 0)).toBe("755224");
    expect(hotp(key, 9)).toBe("520489");
  });
});

describe("verification", () => {
  afterEach(() => {
    delete process.env["APP_TOTP_SECRET"];
    resetTotpReplay();
  });

  it("accepts ±1 step and rejects further drift", () => {
    const now = 1_700_000_000_000;
    const code = totpAt(RFC_SECRET, now);
    expect(matchTotp(RFC_SECRET, code, now)).toBe(totpStep(now));
    expect(matchTotp(RFC_SECRET, code, now + 30_000)).toBe(totpStep(now));
    expect(matchTotp(RFC_SECRET, code, now - 30_000)).toBe(totpStep(now));
    expect(matchTotp(RFC_SECRET, code, now + 90_000)).toBeNull();
    expect(matchTotp(RFC_SECRET, "000000x", now)).toBeNull();
  });

  it("prevents replay of a used code on this instance", () => {
    process.env["APP_TOTP_SECRET"] = RFC_SECRET;
    const now = 1_700_000_000_000;
    const code = totpAt(RFC_SECRET, now);
    expect(verifyLoginTotp(code, now)).toBe(true);
    expect(verifyLoginTotp(code, now)).toBe(false);
    expect(verifyLoginTotp(totpAt(RFC_SECRET, now + 30_000), now + 30_000)).toBe(true);
  });

  it("fails closed without a configured secret", () => {
    expect(verifyLoginTotp("123456")).toBe(false);
  });
});

describe("enrollment helpers", () => {
  it("generates 160-bit secrets and otpauth URIs", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)!.length).toBe(20);
    const uri = buildOtpauthUri({ secret: "ABCD", account: "ilham", issuer: "Dompetku" });
    expect(uri).toBe(
      "otpauth://totp/Dompetku:ilham?secret=ABCD&issuer=Dompetku&algorithm=SHA1&digits=6&period=30",
    );
    expect(formatSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
  });
});
