import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

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
