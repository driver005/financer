import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import {
  base32Decode,
  base32Encode,
  candidateSteps,
  counterBytes,
  isValidTotpSecret,
  normalizeTotpCode,
  TOTP_DIGITS,
  totpStep,
  truncateHmac,
} from "./totp";

/** RFC 4226 HOTP with HMAC-SHA1. */
export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const mac = createHmac("sha1", key).update(counterBytes(counter)).digest();
  return truncateHmac(new Uint8Array(mac), digits);
}

/** RFC 6238 TOTP code for a base32 secret at a given time. */
export function totpAt(secret: string, nowMs: number, digits = TOTP_DIGITS): string {
  const key = base32Decode(secret);
  if (!key) throw new Error("Invalid TOTP secret");
  return hotp(key, totpStep(nowMs), digits);
}

function safeEq(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * Returns the matched time step (±1 window) or null. Every candidate is
 * compared in constant time and the loop never exits early.
 */
export function matchTotp(secret: string, input: string, nowMs = Date.now()): number | null {
  const code = normalizeTotpCode(input);
  const key = base32Decode(secret);
  if (!code || !key) return null;
  let matched: number | null = null;
  for (const step of candidateSteps(totpStep(nowMs))) {
    if (safeEq(hotp(key, step), code) && matched === null) matched = step;
  }
  return matched;
}

/** Configured login secret, or null when 2FA is off / the value is unusable. */
export function configuredTotpSecret(): string | null {
  const s = process.env["APP_TOTP_SECRET"]?.trim();
  if (!s) return null;
  if (!isValidTotpSecret(s)) {
    console.error("APP_TOTP_SECRET bukan base32 yang valid (minimal 16 karakter); 2FA diabaikan.");
    return null;
  }
  return s;
}

// Replay protection: highest step already used on this instance. Serverless
// instances don't share memory, so a code could in theory be replayed once on
// another cold instance within its ~90 s validity; the HMAC challenge (needs
// the password) and the login throttle limit the impact.
let lastUsedStep = -1;

/** Verifies the login code against APP_TOTP_SECRET and burns its step. */
export function verifyLoginTotp(input: string, nowMs = Date.now()): boolean {
  const secret = configuredTotpSecret();
  if (!secret) return false;
  const step = matchTotp(secret, input, nowMs);
  if (step === null || step <= lastUsedStep) return false;
  lastUsedStep = step;
  return true;
}

/** Test helper: resets in-memory replay state. */
export function resetTotpReplay(): void {
  lastUsedStep = -1;
}

/** Fresh random 160-bit base32 secret. */
export function generateTotpSecret(): string {
  return base32Encode(new Uint8Array(randomBytes(20)));
}
