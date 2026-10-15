import { useRootNavigationState, useRouter, useSegments } from "expo-router";
import { useEffect, useRef, useState } from "react";

import { useApi } from "@/api/config";
import { isSetUp } from "@/api/mode";
import { loadOnboarding, markOnboardingDone } from "@/native/onboardingStore";
import { entryAction, type Stored } from "@/onboarding";

/**
 * Sends a first-time user to the setup, once per app start. It renders nothing. What counts as
 * first time is decided by `entryAction`: not done yet and nothing set up. Someone who already
 * had a server or the on-phone mode switched on gets the flag set quietly instead.
 *
 * It acts only once: a person who opens another screen from the setup (the bank sync, say) is not
 * pulled back on every navigation.
 */
export function OnboardingGate() {
  const { loaded, config, mode, modeChosen } = useApi();
  const router = useRouter();
  const segments = useSegments();
  const navigationReady = useRootNavigationState()?.key != null;
  const [stored, setStored] = useState<Stored>(null);
  const handled = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadOnboarding().then((s) => {
      if (!cancelled) setStored(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onOnboarding = (segments as string[])[0] === "onboarding";

  useEffect(() => {
    if (handled.current || !navigationReady) return;
    const action = entryAction({
      stored,
      apiLoaded: loaded,
      configured: isSetUp({ hasServer: config !== null, mode, chosen: modeChosen }),
      onOnboarding,
    });
    if (action === "wait") return;
    handled.current = true;
    if (action === "redirect") router.replace("/onboarding");
    else if (action === "mark_done") void markOnboardingDone();
  }, [stored, loaded, config, mode, modeChosen, onOnboarding, navigationReady, router]);

  return null;
}
