import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

/** Hand a text file to the user: the share sheet on a phone, a download in the browser. */
export async function shareTextFile(name: string, text: string, mimeType: string): Promise<void> {
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device.");
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(text);
  try {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
  } finally {
    // the file holds financial data; do not leave it in the cache
    try {
      file.delete();
    } catch {
      // already gone, or still in use by the share sheet; the OS clears the cache eventually
    }
  }
}

/**
 * Let the user pick a file and read its bytes; `null` if they cancel. On the web the picker
 * returns a browser `File`, which expo-file-system's `File` cannot read, so use that directly.
 */
export async function pickFileBytes(types: string[]): Promise<ArrayBuffer | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  return asset.file ? asset.file.arrayBuffer() : new File(asset.uri).arrayBuffer();
}

/** Let the user pick a text file; `null` if they cancel. */
export async function pickTextFile(types: string[]): Promise<string | null> {
  const bytes = await pickFileBytes(types);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
