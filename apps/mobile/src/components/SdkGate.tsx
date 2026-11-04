import { Screen, Stack, Text } from "@financer/ui";
import { useEffect, useState, type ReactNode } from "react";

import { initSdk } from "../../../../packages/wire/src/connect";

/**
 * Holds the screens back until the Rust SDK is loaded: they ask it for amounts, periods and wording
 * while they draw. In the browser that is the WebAssembly module, on a phone the native one.
 */
export function SdkGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | { error: string }>("loading");
  useEffect(() => {
    let alive = true;
    initSdk().then(
      () => alive && setState("ready"),
      (e) => alive && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, []);
  if (state === "ready") return <>{children}</>;
  if (state === "loading") return null;
  return (
    <Screen>
      <Stack p="lg" gap="md">
        <Text variant="body">The Rust SDK could not be loaded.</Text>
        <Text variant="caption" tone="subtle">{state.error}</Text>
      </Stack>
    </Screen>
  );
}
