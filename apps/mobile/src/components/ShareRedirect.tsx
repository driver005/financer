import { usePathname, useRouter } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import { useEffect } from "react";

/** Renders nothing. When something is shared to Financer from another app, opens the Share screen (once). */
export function ShareRedirect() {
  const { hasShareIntent } = useShareIntentContext();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (hasShareIntent && path !== "/share") router.push("/share");
  }, [hasShareIntent, path, router]);
  return null;
}
