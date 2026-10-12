import type { BuildInfo, Draft, StepId } from "@/onboarding";

/** What the route gives every step: the answers so far and the ways to move around. */
export type StepCtx = {
  draft: Draft;
  /** Merge answers into the draft (and save the progress). */
  update: (patch: Partial<Draft>) => void;
  build: BuildInfo;
  /** Progress bar position (0..1) and its text, like "3/8". */
  fraction: number;
  stepLabel: string;
  back: () => void;
  /** On the first step the back button closes the setup. */
  backIsClose: boolean;
  next: () => void;
  goto: (step: StepId) => void;
  /** Leave without finishing, never to be shown again unless replayed. */
  close: () => void;
  /** Finish and go to a screen of the app. */
  finish: (route: string) => void;
};
