import Constants from "expo-constants";
import { Platform } from "react-native";

import { Card, useColors } from "@/components/ui";
import { Text } from "@/components/kit";

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

export function AboutCard() {
  const c = useColors();
  return (
    <Card>
      <Text variant="titleMedium">About</Text>
      <Text variant="bodyMedium" style={{ marginTop: 4 }} accessibilityLabel={`App version ${versionLabel()}`}>
        Financer {versionLabel()}
      </Text>
      <Text variant="bodySmall" style={{ color: c.muted, marginTop: 2 }}>
        This is the version of the app, not of the server it talks to.
      </Text>
    </Card>
  );
}
