import { Text as RNText, View } from "react-native";

import { ChunkyButton } from "@/components/kit";
import { MascotFace } from "@/components/Mascot";
import type { Mood } from "@/game";
import { space, typography, usePalette } from "@/theme";

/**
 * A real empty state: the mascot, one sentence that says what is missing and why, and (at most)
 * one action. Use it instead of a grey line of text whenever a list or a screen has nothing yet.
 */
export function EmptyState({
  title,
  message,
  actionLabel,
  actionIcon,
  onAction,
  mood = "happy",
  tone = "green",
}: {
  title: string;
  message?: string;
  actionLabel?: string;
  actionIcon?: string;
  onAction?: () => void;
  mood?: Mood;
  tone?: "green" | "blue";
}) {
  const p = usePalette();
  return (
    <View style={{ alignItems: "center", paddingVertical: space.xl, paddingHorizontal: space.lg, gap: space.md }}>
      <MascotFace mood={mood} size={88} />
      <RNText accessibilityRole="header" style={[typography.heading, { color: p.text, textAlign: "center", marginTop: space.sm }]}>
        {title}
      </RNText>
      {message ? <RNText style={[typography.body, { color: p.muted, textAlign: "center", maxWidth: 320 }]}>{message}</RNText> : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: space.sm, alignSelf: "stretch", maxWidth: 320, width: "100%" }}>
          <ChunkyButton label={actionLabel} icon={actionIcon} tone={tone} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}
