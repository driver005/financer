import { useEffect } from "react";
import { Platform } from "react-native";
import { Box, Button, Cover, IconBadge, Text } from "@financer/ui";

import { isAppCovered, startAppLock, unlockApp, useAppLock, useForegroundTick } from "@/native/appLock";

/**
 * Covers the whole app while it is locked, and until we know whether the lock is on. It renders
 * nothing on the web. It sits on top of the screens instead of replacing them, so their state
 * survives a lock.
 */
export function AppLockOverlay() {
  const view = useAppLock();
  const tick = useForegroundTick();
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
    <Cover>
      {locked ? (
        <Box gap="lg" align="center" maxW="narrow">
          <IconBadge icon="lock-outline" />
          <Text variant="title" level={1}>Financer is locked</Text>
          <Text variant="body" tone="muted">Confirm it is you to continue.</Text>
          <Button label="Unlock" icon="lock-open-outline" onPress={() => void unlockApp()} full />
        </Box>
      ) : null}
    </Cover>
  );
}
