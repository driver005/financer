import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect } from "react";
import { Platform, StyleSheet, View } from "react-native";

import { Body, Button, useColors } from "@/components/ui";
import { Text } from "@/components/kit";
import { isAppCovered, startAppLock, unlockApp, useAppLock, useForegroundTick } from "@/native/appLock";

/**
 * Covers the whole app while it is locked, and until we know whether the lock is on. It renders
 * nothing on the web. It sits on top of the screens instead of replacing them, so their state
 * survives a lock.
 */
export function AppLockOverlay() {
  const view = useAppLock();
  const tick = useForegroundTick();
  const c = useColors();
  const covered = isAppCovered(view);
  const locked = view.state.locked && view.state.ready;

  useEffect(() => {
    void startAppLock();
  }, []);

  // ask for the fingerprint/face/passcode by itself when the cover appears and on each return
  useEffect(() => {
    if (locked) void unlockApp(true);
  }, [locked, tick]);

  if (Platform.OS === "web" || !covered) return null;
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, zIndex: 1000, elevation: 1000, alignItems: "center", justifyContent: "center", padding: 24 }]}
      accessibilityViewIsModal
      importantForAccessibility="yes"
    >
      {locked ? (
        <>
          <View
            style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: c.card, borderWidth: 2, borderColor: c.border, alignItems: "center", justifyContent: "center" }}
          >
            <MaterialCommunityIcons name="lock-outline" size={44} color={c.accent} />
          </View>
          <Text variant="headlineSmall" style={{ marginTop: 20, fontWeight: "800" }} accessibilityRole="header">
            Financer is locked
          </Text>
          <View style={{ marginTop: 8, marginBottom: 20 }}>
            <Body muted>Confirm it is you to continue.</Body>
          </View>
          <View style={{ alignSelf: "stretch" }}>
            <Button label="Unlock" icon="lock-open-outline" onPress={() => void unlockApp()} />
          </View>
        </>
      ) : null}
    </View>
  );
}
