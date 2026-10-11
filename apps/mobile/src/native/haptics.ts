import * as Haptics from "expo-haptics";

// Feedback is a nicety: never let a missing haptic engine (web, some Android devices) break a tap.
export function tap(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function celebrate(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
