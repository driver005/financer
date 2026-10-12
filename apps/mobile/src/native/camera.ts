import { Platform } from "react-native";

type CameraModule = typeof import("expo-camera");

let cached: CameraModule | null | undefined;

/**
 * The camera module, or `null` where there is none: on the web (barcodes are typed there) and in
 * a build that lacks the native code. A static import would crash the whole app in that case,
 * so it is loaded on first use and a failure just means "no camera".
 */
export function loadCamera(): CameraModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === "web") {
    cached = null;
    return cached;
  }
  try {
    cached = require("expo-camera") as CameraModule;
  } catch {
    cached = null;
  }
  return cached;
}
