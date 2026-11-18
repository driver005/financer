import { afterEach, describe, expect, it, vi } from "vitest";
import { compact, money } from "../lib/format";
import {
  isPrivate,
  MASK,
  PRIVACY_KEY,
  readStoredPrivacy,
  secret,
  setPrivate,
  subscribePrivacy,
  togglePrivate,
} from "../lib/privacy";

afterEach(() => {
  setPrivate(false);
  document.documentElement.classList.remove("privacy");
  localStorage.clear();
});

describe("privacy store", () => {
  it("starts visible and toggles with persistence + html class", () => {
    expect(isPrivate()).toBe(false);
    togglePrivate();
    expect(isPrivate()).toBe(true);
    expect(localStorage.getItem(PRIVACY_KEY)).toBe("1");
    expect(document.documentElement.classList.contains("privacy")).toBe(true);
    togglePrivate();
    expect(localStorage.getItem(PRIVACY_KEY)).toBe("0");
    expect(document.documentElement.classList.contains("privacy")).toBe(false);
  });

  it("notifies subscribers only on change and can unsubscribe", () => {
    const fn = vi.fn();
    const off = subscribePrivacy(fn);
    setPrivate(true);
    setPrivate(true);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    setPrivate(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not persist when persist=false", () => {
    setPrivate(true, false);
    expect(localStorage.getItem(PRIVACY_KEY)).toBeNull();
  });

  it("reads the stored preference from the html class or localStorage", () => {
    expect(readStoredPrivacy()).toBe(false);
    localStorage.setItem(PRIVACY_KEY, "1");
    expect(readStoredPrivacy()).toBe(true);
    localStorage.clear();
    document.documentElement.classList.add("privacy");
    expect(readStoredPrivacy()).toBe(true);
  });

  it("survives a throwing localStorage", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setPrivate(true)).not.toThrow();
    expect(isPrivate()).toBe(true);
    spy.mockRestore();
  });
});

describe("format masking", () => {
  it("formats normally when visible", () => {
    expect(money(1500000)).toMatch(/^Rp\s1\.500\.000$/);
    expect(compact(1500000)).toMatch(/1,5/);
  });

  it("masks money with a fixed-length mask keeping the currency prefix", () => {
    setPrivate(true);
    expect(money(1500000)).toBe(`Rp ${MASK}`);
    expect(money(5)).toBe(money(999_999_999));
    expect(money(12.5, "USD")).toBe(`$ ${MASK}`);
    expect(compact(1500000)).toBe("•••");
    expect(compact(3)).toBe(compact(3_000_000_000));
  });

  it("reveals in form contexts", () => {
    setPrivate(true);
    expect(money(1500000, "IDR", { reveal: true })).toMatch(/1\.500\.000/);
    expect(compact(1500000, { reveal: true })).toMatch(/1,5/);
  });

  it("secret() masks arbitrary sensitive text", () => {
    expect(secret("2.5")).toBe("2.5");
    setPrivate(true);
    expect(secret("2.5")).toBe(MASK);
    expect(secret("2.5", { reveal: true })).toBe("2.5");
  });
});
