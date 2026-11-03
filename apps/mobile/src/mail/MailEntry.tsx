import { useRouter } from "expo-router";
import { useMemo, type ComponentType } from "react";

import { useApi } from "@/api/config";
import { wireFor } from "../../../../packages/wire/src/connect";

type Server = { baseUrl: string; token: string };
type Host = { server: () => Promise<Server | null>; onExit: () => void; makeCaller: (config: Server) => Promise<unknown> };

// The mail client is bundled source from packages/mail, drawn entirely with packages/ui. It is
// loaded with `require` so this app's type check does not descend into it (the catalog checks it).
const { MailModule, mailCaller } = require("../../../../packages/mail/src") as {
  MailModule: ComponentType<{ host: Host }>;
  mailCaller: (wire: unknown) => unknown;
};

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
      makeCaller: async (c) => mailCaller(await wireFor(c)),
    }),
    [config, mode, router],
  );
  return <MailModule host={host} />;
}
