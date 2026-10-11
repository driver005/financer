import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// On iOS and Android secrets live in the Keychain / Keystore. expo-secure-store has no usable
// web implementation, so the web build (development only) falls back to localStorage, which
// is NOT secure storage; do not use the web build with a real bank server.
const web = Platform.OS === "web";

export async function getSecret(key: string): Promise<string | null> {
  if (web) return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (web) {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function deleteSecret(key: string): Promise<void> {
  if (web) {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
