import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

/** UTF-8 safe base64 encoder that also works in Hermes (no btoa). */
export function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += alphabet[a >> 2];
    out += alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : alphabet[c & 63];
  }
  return out;
}

/** Save a base64 document locally: browser download on web, share sheet on device. */
export async function saveDocument(base64: string, filename: string, mimeType: string): Promise<void> {
  const binary = typeof globalThis.atob === "function" ? globalThis.atob(base64) : "";
  if (Platform.OS === "web") {
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  const uri = `${FileSystem.Paths.cache.uri}${filename}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: filename });
}
