import { useRouter } from "expo-router";
import { useMemo, type ComponentType } from "react";

import { useApi } from "@/api/config";

type Host = { server: () => Promise<{ baseUrl: string; token: string } | null>; onExit: () => void; sdk?: unknown };

// The mail client is bundled source from packages/mail, drawn entirely with packages/ui. It is
// loaded with `require` so this app's type check does not descend into it (the catalog checks it).
const { MailModule } = require("../../../../packages/mail/src") as { MailModule: ComponentType<{ host: Host }> };

// The Rust SDK, in builds made with EXPO_PUBLIC_RUST_SDK=1 (scripts/enable-sdk.sh). The flag is tested
// here with the variable written out, so a build without it leaves the generated bindings out of the
// bundle entirely, like the shopping assistant (see ../shop/ShoppingEntry.tsx and docs/SDK.md).
const rustSdk: unknown = process.env.EXPO_PUBLIC_RUST_SDK === "1" ? require("./rustSdk").rustSdk : null;

/**
 * The mail client inside the finance app. It lives on the same server and uses the same token, so
 * there is nothing to set up here. It needs a server (not the on-phone backend): mail is read and
 * sent by the server.
 */
export function MailEntry() {
  const { config, mode } = useApi();
  const router = useRouter();
  const host = useMemo<Host>(
    () => ({
      server: async () => (mode === "remote" && config ? { baseUrl: config.baseUrl, token: config.token } : null),
      onExit: () => (router.canGoBack() ? router.back() : router.replace("/")),
      sdk: rustSdk,
    }),
    [config, mode, router],
  );
  return <MailModule host={host} />;
}
