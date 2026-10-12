import { deleteSecret, getSecret, setSecret } from "@/api/storage";
import { mergeProfile, newState, parseProfile, parseState, serializeState, type Draft, type OnboardingState, type Profile, type Stored } from "@/onboarding";

// A few small keys in the same storage the rest of the app uses (secure storage on a phone,
// localStorage in the browser). The state is saved after every step, so killing the app resumes
// where it was; the flag is what stops the setup from showing again.
export const ONBOARDING_STATE_KEY = "financer.onboarding.state";
export const ONBOARDING_DONE_KEY = "financer.onboarding.done";
/** Household size, stores and postal code: kept on the device after the setup (see `Profile`). */
export const PROFILE_KEY = "financer.profile";

export async function loadProfile(): Promise<Profile> {
  try {
    return parseProfile(await getSecret(PROFILE_KEY));
  } catch {
    return {};
  }
}

/** Remember the profile answers of this run (others stay as they were). */
export async function saveProfile(draft: Draft): Promise<void> {
  try {
    const next = mergeProfile(await loadProfile(), draft);
    if (Object.keys(next).length) await setSecret(PROFILE_KEY, JSON.stringify(next));
  } catch {
    // a convenience: the setup does not fail over it
  }
}

/** What is stored. Storage that cannot be read counts as "not done, nothing started". */
export async function loadOnboarding(): Promise<NonNullable<Stored>> {
  let done = false;
  let state: OnboardingState | null = null;
  try {
    done = (await getSecret(ONBOARDING_DONE_KEY)) === "1";
  } catch {
    // unreadable: treat as not done
  }
  try {
    state = parseState(await getSecret(ONBOARDING_STATE_KEY));
  } catch {
    // unreadable: start from the top
  }
  return { done, state };
}

export async function saveOnboardingState(state: OnboardingState): Promise<void> {
  try {
    await setSecret(ONBOARDING_STATE_KEY, serializeState(state));
  } catch {
    // progress is a convenience: if it cannot be saved the setup still works
  }
}

/** The setup is over (finished or closed): never show it again unless replayed. */
export async function markOnboardingDone(): Promise<void> {
  try {
    await setSecret(ONBOARDING_DONE_KEY, "1");
  } catch {
    // without the flag the setup would come back next start; nothing more can be done here
  }
  await deleteSecret(ONBOARDING_STATE_KEY).catch(() => {});
}

/** Settings > Replay setup: forget that it was done and start from the welcome step. */
export async function startReplay(): Promise<void> {
  await deleteSecret(ONBOARDING_DONE_KEY).catch(() => {});
  await saveOnboardingState(newState());
}
