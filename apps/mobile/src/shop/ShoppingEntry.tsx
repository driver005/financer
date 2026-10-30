import { useRouter } from "expo-router";
import { useMemo, type ComponentType } from "react";

import { useApi } from "@/api/config";
import { ShopBackend } from "../../modules/financer-embedded";

type Host = unknown;
type ShoppingExports = {
  ShoppingModule: ComponentType<{ host: Host }>;
  createHost: (options: {
    ShopBackend: unknown;
    sharedServer: () => Promise<{ baseUrl: string; token: string } | null>;
    onExit: () => void;
  }) => Host;
  registerIndexService: () => void;
};

// The shopping assistant is bundled source from packages/shopping. It is loaded with `require`
// so this app's type check does not descend into it (that package is checked by apps/shopping).
// The flag is tested right here, with the environment variable written out: that is the form the
// bundler can fold away, so a build without EXPO_PUBLIC_SHOPPING=1 leaves the code out entirely
// (a flag imported from another file would not be folded). See src/modules.ts.
const shopping: ShoppingExports | null =
  process.env.EXPO_PUBLIC_SHOPPING === "1" ? require("../../../../packages/shopping/src") : null;
shopping?.registerIndexService();

/**
 * The shopping assistant inside the finance app. It reuses the finance app's server and token when
 * the finance app talks to one (the bundled server serves both under /v1), and otherwise runs on
 * this phone when the build has the on-phone backend.
 */
export function ShoppingEntry() {
  const { config, mode } = useApi();
  const router = useRouter();
  const host = useMemo(
    () =>
      shopping?.createHost({
        ShopBackend,
        sharedServer: async () => (mode === "remote" && config ? { baseUrl: config.baseUrl, token: config.token } : null),
        onExit: () => (router.canGoBack() ? router.back() : router.replace("/")),
      }),
    [config, mode, router],
  );
  if (!shopping || !host) return null;
  const Module = shopping.ShoppingModule;
  return <Module host={host} />;
}
