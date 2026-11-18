/**
 * Pure TOTP helpers (RFC 6238 / RFC 4226), client-safe and unit-tested.
 * The HMAC-SHA1 itself lives in totp.server.ts (node crypto).
 */
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
/** Accepted clock drift in steps on each side (±30 s). */
export const TOTP_WINDOW = 1;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decodes RFC 4648 base32 (case/space/hyphen insensitive, padding optional). Null when invalid. */
export function base32Decode(input: string): Uint8Array | null {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!clean || !/^[A-Z2-7]+$/.test(clean)) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** Encodes bytes as unpadded uppercase base32. */
export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32[(value >>> bits) & 31];
    }
    value &= 0xff;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

/** Time step counter for a unix time in milliseconds. */
export function totpStep(nowMs: number, period = TOTP_PERIOD): number {
  return Math.floor(nowMs / 1000 / period);
}

/** 8-byte big-endian counter message for HOTP. */
export function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  let hi = Math.floor(counter / 2 ** 32);
  let lo = counter >>> 0;
  for (let i = 7; i >= 4; i--) {
    buf[i] = lo & 0xff;
    lo >>>= 8;
  }
  for (let i = 3; i >= 0; i--) {
    buf[i] = hi & 0xff;
    hi = Math.floor(hi / 256);
  }
  return buf;
}

/** RFC 4226 dynamic truncation of an HMAC digest into a zero-padded code. */
export function truncateHmac(hmac: Uint8Array, digits = TOTP_DIGITS): string {
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** Steps to try for a given current step, current first. */
export function candidateSteps(step: number, window = TOTP_WINDOW): number[] {
  const out = [step];
  for (let i = 1; i <= window; i++) out.push(step - i, step + i);
  return out.filter((s) => s >= 0);
}

/** Strips spaces/hyphens from user input; returns null unless exactly `digits` digits. */
export function normalizeTotpCode(input: string, digits = TOTP_DIGITS): string | null {
  const c = input.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${digits}}$`).test(c) ? c : null;
}

/** True when a base32 secret decodes to at least 10 bytes (80 bits, RFC 4226 minimum). */
export function isValidTotpSecret(secret: string): boolean {
  const b = base32Decode(secret);
  return !!b && b.length >= 10;
}

/** Builds an otpauth:// URI understood by Google Authenticator, Aegis, 1Password, etc. */
export function buildOtpauthUri(opts: { secret: string; account: string; issuer: string }): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const q = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** Groups a secret into blocks of 4 for easier manual typing. */
export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}
