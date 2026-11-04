/**
 * What to do with something another app shared to Financer (a receipt from the dm, Rossmann,
 * Edeka, Netto or Penny app, a PDF invoice, a screenshot, an order list). Pure (no React Native),
 * unit-tested; the share screen does the reading.
 */

/** The parts of a shared item that are used (a subset of expo-share-intent's). */
export type SharedItem = {
  files?: { path: string; mimeType: string; fileName: string }[] | null;
  text?: string | null;
  webUrl?: string | null;
};

export type ShareKind =
  | { kind: "pdf"; path: string; name: string }
  | { kind: "image"; path: string; name: string; mime: "image/jpeg" | "image/png" | "image/webp" }
  | { kind: "csv"; path: string; name: string }
  | { kind: "text"; text: string }
  | { kind: "link"; url: string }
  | { kind: "unsupported"; what: string }
  | { kind: "none" };

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/** What was shared, in the order of what can be done with it: a file first, then text, then a link. */
export function classifyShare(s: SharedItem | null | undefined): ShareKind {
  if (!s) return { kind: "none" };
  const file = s.files?.[0];
  if (file) {
    const mime = (file.mimeType || "").toLowerCase();
    const name = file.fileName || "the file";
    const lower = name.toLowerCase();
    if (mime === "application/pdf" || lower.endsWith(".pdf")) return { kind: "pdf", path: file.path, name };
    if (mime === "image/heic" || mime === "image/heif" || lower.endsWith(".heic")) return { kind: "unsupported", what: "a HEIC photo (take a screenshot of the receipt instead, or share it as JPEG)" };
    const image = IMAGE_MIME.find((m) => m === mime) ?? (/\.(jpe?g)$/.test(lower) ? "image/jpeg" : /\.png$/.test(lower) ? "image/png" : /\.webp$/.test(lower) ? "image/webp" : null);
    if (image) return { kind: "image", path: file.path, name, mime: image };
    if (mime === "text/csv" || mime === "text/comma-separated-values" || lower.endsWith(".csv")) return { kind: "csv", path: file.path, name };
    return { kind: "unsupported", what: `${name} (${mime || "unknown type"})` };
  }
  const text = s.text?.trim() ?? "";
  const url = s.webUrl?.trim() ?? "";
  // a text that is only a link cannot be read; one with a receipt in it can
  if (text && (!url || text.replace(url, "").trim().length > 20)) return { kind: "text", text: text.slice(0, 100_000) };
  if (url) return { kind: "link", url };
  return { kind: "none" };
}

/** `file:///x` for a path that may or may not have the scheme (the two systems differ). */
export function fileUri(path: string): string {
  return /^file:\/\//.test(path) ? path : `file://${path.startsWith("/") ? "" : "/"}${path}`;
}

/** A shared CSV waits here for the order-import screen, which reads it once. */
let pendingCsv: { name: string; text: string } | null = null;

export function holdCsv(name: string, text: string): void {
  pendingCsv = { name, text };
}

export function takeCsv(): { name: string; text: string } | null {
  const held = pendingCsv;
  pendingCsv = null;
  return held;
}
