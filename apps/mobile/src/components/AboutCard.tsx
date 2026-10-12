import Constants from "expo-constants";
import { Platform } from "react-native";

import { SettingsRow } from "@/components/settings/SettingsKit";

/**
 * "Version 1.4.2 (build 1004002)". Release builds carry the version of the tag they were built
 * from (apps/mobile/scripts/set-version.mjs); a local or manual build shows the version in the
 * repository. The server has no version endpoint (its /health answer is just "ok"), so only the
 * app is listed.
 */
function versionLabel(): string {
  const cfg = Constants.expoConfig;
  const version = cfg?.version ?? "unknown";
  const build = Platform.OS === "android" ? cfg?.android?.versionCode : Platform.OS === "ios" ? cfg?.ios?.buildNumber : undefined;
  return build !== undefined && build !== null ? `${version} (build ${build})` : version;
}

/** Settings, About: the app version as a read-only row. */
export function AboutCard() {
  return (
    <SettingsRow
      icon="information-outline"
      title="Financer"
      value={versionLabel()}
      subtitle="The version of the app, not of the server it talks to."
      accessibilityLabel={`App version ${versionLabel()}. This is the version of the app, not of the server it talks to.`}
    />
  );
}
