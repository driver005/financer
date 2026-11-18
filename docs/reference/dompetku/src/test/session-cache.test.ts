import { afterEach, describe, expect, it } from "vitest";
import {
  clearSessionCache,
  getCachedSession,
  isUnauthorizedError,
  SESSION_TTL_MS,
  setCachedSession,
} from "@/lib/session-cache";

afterEach(() => clearSessionCache());

describe("session cache", () => {
  it("returns a fresh entry and expires after the TTL", () => {
    setCachedSession("me", 1000);
    expect(getCachedSession(1000 + SESSION_TTL_MS - 1)).toEqual({ user: "me" });
    expect(getCachedSession(1000 + SESSION_TTL_MS + 1)).toBeNull();
  });

  it("is cleared on demand", () => {
    setCachedSession("me");
    clearSessionCache();
    expect(getCachedSession()).toBeNull();
  });

  it("detects Unauthorized errors only", () => {
    expect(isUnauthorizedError(new Error("Unauthorized"))).toBe(true);
    expect(isUnauthorizedError(new Error("boom"))).toBe(false);
    expect(isUnauthorizedError("Unauthorized")).toBe(false);
  });
});
