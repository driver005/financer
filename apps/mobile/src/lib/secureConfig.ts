/** SecureStore on device, localStorage fallback on web (Expo SecureStore has no web backend here). */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export async function getConfig(key: string): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setConfig(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") { globalThis.localStorage?.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteConfig(key: string): Promise<void> {
  if (Platform.OS === "web") { globalThis.localStorage?.removeItem(key); return; }
  await SecureStore.deleteItemAsync(key);
}
