/** Playful Duolingo-style components from the Stitch "Pantry Playful" design system. */
import React from "react";
import { Pressable, StyleSheet, Text as RNText, View } from "react-native";
import { Box, Button, Card, Icon, Text, useFinanceTheme } from "./primitives";
import { palette, radius, spacing, typography } from "./tokens";

export function StreakBadge({ days }: { days: number }) {
  return (
    <View style={styles.streak}>
      <RNText style={styles.streakText}>{`🔥 ${days} day streak`}</RNText>
    </View>
  );
}

export function XpBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (current / total) * 100) : 0;
  return (
    <View style={styles.xpWrap}>
      <View style={styles.xpTrack}><View style={[styles.xpFill, { width: `${pct}%` }]} /></View>
      <RNText style={styles.xpLabel}>{`${current} / ${total} XP`}</RNText>
    </View>
  );
}

/** Big friendly green hero card — the single focal point of each main screen. */
export function PlayHero({ emoji, title, value, caption, progress, onPress, cta }: {
  emoji: string; title: string; value: string; caption?: string; progress?: number;
  onPress?: () => void; cta?: string;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? "button" : undefined} style={styles.hero}>
      <Box row style={{ alignItems: "center", gap: 10 }}>
        <RNText style={styles.heroEmoji}>{emoji}</RNText>
        <RNText style={[styles.heroTitle, { fontFamily: typography.font.display }]}>{title}</RNText>
      </Box>
      <RNText style={[styles.heroValue, { fontFamily: typography.font.display }]}>{value}</RNText>
      {caption ? <RNText style={styles.heroCaption}>{caption}</RNText> : null}
      {progress !== undefined ? <View style={styles.heroTrack}><View style={[styles.heroFill, { width: `${Math.min(100, Math.max(0, progress * 100))}%` }]} /></View> : null}
      {cta ? (
        <View style={styles.heroCta}><RNText style={styles.heroCtaText}>{cta}</RNText></View>
      ) : null}
    </Pressable>
  );
}

export function MascotEmpty({ emoji = "🦉", title, message, actionLabel, onAction }: {
  emoji?: string; title: string; message: string; actionLabel?: string; onAction?: () => void;
}) {
  return (
    <Card style={styles.empty}>
      <RNText style={styles.emptyEmoji}>{emoji}</RNText>
      <Text variant="heading3">{title}</Text>
      <Text variant="body3" color="muted" style={styles.emptyMessage}>{message}</Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </Card>
  );
}

/** Numbered, game-like task row with a thick green progress indicator. */
export function StepCard({ number, title, subtitle, progress, onPress }: {
  number: number; title: string; subtitle?: string; progress?: number; onPress?: () => void;
}) {
  const theme = useFinanceTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? "button" : undefined} style={[styles.step, { borderColor: theme.border }]}>
      <View style={styles.stepNumber}><RNText style={styles.stepNumberText}>{number}</RNText></View>
      <View style={{ flex: 1 }}>
        <Text variant="heading5">{title}</Text>
        {subtitle ? <Text variant="body4" color="muted">{subtitle}</Text> : null}
        {progress !== undefined ? <View style={styles.stepTrack}><View style={[styles.stepFill, { width: `${Math.min(100, progress * 100)}%` }]} /></View> : null}
      </View>
      <Icon name="chevron-right" size={20} color={theme.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  streak: { backgroundColor: "#FFF4CC", borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 6 },
  streakText: { color: "#A36A00", fontWeight: "800", fontSize: 13 },
  xpWrap: { gap: 4, marginTop: 8 },
  xpTrack: { height: 10, borderRadius: 999, backgroundColor: "#FFF0B3", overflow: "hidden" },
  xpFill: { height: 10, borderRadius: 999, backgroundColor: palette.accent },
  xpLabel: { fontSize: 11, fontWeight: "800", color: "#A36A00" },
  hero: { backgroundColor: palette.primary, borderBottomWidth: 5, borderBottomColor: palette.primaryDark,
    borderRadius: radius.card, padding: spacing.xl, gap: spacing.sm },
  heroEmoji: { fontSize: 30 },
  heroTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  heroValue: { color: "#FFFFFF", fontSize: 36, fontWeight: "800" },
  heroCaption: { color: "#EAFFD8", fontSize: 14, fontWeight: "600" },
  heroTrack: { height: 14, borderRadius: 999, backgroundColor: "#46A302", marginTop: 8, overflow: "hidden" },
  heroFill: { height: 14, borderRadius: 999, backgroundColor: "#FFFFFF" },
  heroCta: { alignSelf: "flex-start", backgroundColor: "#FFFFFF", borderRadius: 14, paddingHorizontal: 18, paddingVertical: 10, marginTop: 8 },
  heroCtaText: { color: palette.primaryDark, fontWeight: "800", textTransform: "uppercase", fontSize: 13 },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.md },
  emptyEmoji: { fontSize: 56 },
  emptyMessage: { textAlign: "center", maxWidth: 260 },
  step: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 2, borderRadius: radius.card, padding: spacing.md },
  stepNumber: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.mint, alignItems: "center", justifyContent: "center" },
  stepNumberText: { color: palette.primaryDark, fontWeight: "800", fontSize: 18 },
  stepTrack: { height: 10, borderRadius: 999, backgroundColor: "#F0F0F0", marginTop: 8, overflow: "hidden" },
  stepFill: { height: 10, borderRadius: 999, backgroundColor: palette.primary },
});
