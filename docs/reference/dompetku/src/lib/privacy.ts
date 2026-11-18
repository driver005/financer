/**
 * Privacy mode ("sembunyikan angka"): a tiny external store so plain formatters
 * (money()/compact() in format.ts) can mask amounts and React components can
 * subscribe via usePrivacy(). Per-device preference in localStorage `dk-privacy`;
 * the inline script in __root.tsx adds `privacy` on <html> before first paint.
 *
 * The store always starts `false` (server and client) so hydration matches the
 * SSR HTML; PrivacySync (root) then loads the stored value after hydration while
 * CSS blurs <main> until `privacy-live` is set, so real numbers never flash.
 */
import { useSyncExternalStore } from "react";

export const PRIVACY_KEY = "dk-privacy";
export const MASK = "••••••";

let hidden = false;
const listeners = new Set<() => void>();

export function isPrivate(): boolean {
  return hidden;
}

/** True once PrivacySync has applied the stored value (CSS stops blurring <main>). */
export function markPrivacyLive(): void {
  if (typeof document !== "undefined") document.documentElement.classList.add("privacy-live");
}

export function subscribePrivacy(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Update the store (and <html> class); `persist` writes localStorage. */
export function setPrivate(next: boolean, persist = true): void {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("privacy", next);
  }
  if (persist) {
    try {
      localStorage.setItem(PRIVACY_KEY, next ? "1" : "0");
    } catch {
      /* storage blocked: keep in-memory only */
    }
  }
  if (next === hidden) return;
  hidden = next;
  listeners.forEach((l) => l());
}

export function togglePrivate(): void {
  setPrivate(!hidden);
}

/** Stored preference: the <html> class set by the inline script, else localStorage. */
export function readStoredPrivacy(): boolean {
  if (typeof document !== "undefined" && document.documentElement.classList.contains("privacy")) {
    return true;
  }
  try {
    return localStorage.getItem(PRIVACY_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mask any sensitive non-money text (e.g. gold grams) when privacy is on. */
export function secret(text: string, opts?: { reveal?: boolean }): string {
  return hidden && !opts?.reveal ? MASK : text;
}

/** Re-renders the caller when privacy mode toggles. Server snapshot is always false. */
export function usePrivacy(): boolean {
  return useSyncExternalStore(subscribePrivacy, isPrivate, () => false);
}
