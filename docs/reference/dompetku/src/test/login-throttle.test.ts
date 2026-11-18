import { describe, expect, it } from "vitest";
import {
  isLoginLocked,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  pruneFailures,
} from "@/lib/login-throttle";

describe("login throttle", () => {
  it("locks only once failures reach the limit", () => {
    expect(isLoginLocked(0)).toBe(false);
    expect(isLoginLocked(LOGIN_MAX_FAILURES - 1)).toBe(false);
    expect(isLoginLocked(LOGIN_MAX_FAILURES)).toBe(true);
    expect(isLoginLocked(LOGIN_MAX_FAILURES + 5)).toBe(true);
    expect(isLoginLocked(Number.NaN)).toBe(false);
  });

  it("prunes failures outside the window", () => {
    const now = 10 * LOGIN_WINDOW_MS;
    expect(
      pruneFailures([now - LOGIN_WINDOW_MS - 1, now - LOGIN_WINDOW_MS, now - 1, now], now),
    ).toEqual([now - 1, now]);
  });
});
