import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { BackHandler, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useApi } from "@/api/config";
import { DataStep } from "@/components/onboarding/DataStep";
import { FinishStep } from "@/components/onboarding/FinishStep";
import { HabitsStep } from "@/components/onboarding/HabitsStep";
import { HouseholdStep } from "@/components/onboarding/HouseholdStep";
import { MoneyStep } from "@/components/onboarding/MoneyStep";
import { RhythmStep } from "@/components/onboarding/RhythmStep";
import { SafetyStep } from "@/components/onboarding/SafetyStep";
import type { StepCtx } from "@/components/onboarding/types";
import { WelcomeStep } from "@/components/onboarding/WelcomeStep";
import { Loading } from "@/components/ui";
import { loadOnboarding, markOnboardingDone, saveOnboardingState, saveProfile } from "@/native/onboardingStore";
import {
  newState,
  nextStep,
  previousStep,
  progressOf,
  resolveStep,
  stepsFor,
  type BuildInfo,
  type Draft,
  type OnboardingState,
  type StepId,
} from "@/onboarding";

/**
 * First-run setup. This file only moves between the steps and keeps the progress; what each step
 * asks is in `components/onboarding/`, the rules are in `onboarding.ts`.
 */
export default function Onboarding() {
  const { embeddedAvailable } = useApi();
  const router = useRouter();
  const build = useMemo<BuildInfo>(
    () => ({ platform: Platform.OS === "web" ? "web" : Platform.OS === "ios" ? "ios" : "android", embeddedAvailable }),
    [embeddedAvailable],
  );
  const steps = useMemo(() => stepsFor(build), [build]);
  const [state, setStateRaw] = useState<OnboardingState | null>(null);
  // the latest state, so quick consecutive updates (a step that sets two answers) never overwrite each other
  const latest = useRef<OnboardingState | null>(null);

  const setState = useCallback((next: OnboardingState) => {
    latest.current = next;
    setStateRaw(next);
    void saveOnboardingState(next);
  }, []);

  // Read the saved progress whenever the screen comes into focus: the tab stays mounted, so a
  // replay from Settings has to start over from what is stored, not from what was on screen.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadOnboarding().then((stored) => {
        if (cancelled) return;
        const base = stored.state ?? newState();
        const next = { ...base, step: resolveStep(steps, base.step) };
        latest.current = next;
        setStateRaw(next);
      });
      return () => {
        cancelled = true;
      };
    }, [steps]),
  );

  const update = useCallback(
    (patch: Partial<Draft>) => {
      const cur = latest.current;
      if (cur) setState({ ...cur, draft: { ...cur.draft, ...patch } });
    },
    [setState],
  );

  const goto = useCallback(
    (step: StepId) => {
      const cur = latest.current;
      if (cur) setState({ ...cur, step });
    },
    [setState],
  );

  // Leaving ends the setup for good (it is replayed from Settings), so keep what has no other home first.
  const leave = useCallback(
    async (route: string) => {
      if (latest.current) await saveProfile(latest.current.draft);
      await markOnboardingDone();
      router.replace(route as never);
    },
    [router],
  );
  const close = useCallback(() => void leave("/"), [leave]);
  const finish = useCallback((route: string) => void leave(route), [leave]);

  const step = state?.step;
  const back = useCallback(() => {
    if (!step) return;
    const prev = previousStep(steps, step);
    if (prev) goto(prev);
    else close();
  }, [step, steps, goto, close]);

  // The Android back button steps back through the setup instead of leaving the app.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        back();
        return true;
      });
      return () => sub.remove();
    }, [back]),
  );

  if (!state) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Loading />
      </SafeAreaView>
    );
  }

  const { index, total, fraction } = progressOf(steps, state.step);
  const ctx: StepCtx = {
    draft: state.draft,
    update,
    build,
    fraction,
    stepLabel: `${index + 1}/${total}`,
    back,
    backIsClose: previousStep(steps, state.step) === null,
    next: () => {
      const n = nextStep(steps, state.step);
      if (n) goto(n);
    },
    goto,
    close,
    finish,
  };

  switch (state.step) {
    case "welcome":
      return <WelcomeStep ctx={ctx} />;
    case "data":
      return <DataStep ctx={ctx} />;
    case "household":
      return <HouseholdStep ctx={ctx} />;
    case "rhythm":
      return <RhythmStep ctx={ctx} />;
    case "habits":
      return <HabitsStep ctx={ctx} />;
    case "money":
      return <MoneyStep ctx={ctx} />;
    case "safety":
      return <SafetyStep ctx={ctx} />;
    case "finish":
      return <FinishStep ctx={ctx} />;
  }
}
