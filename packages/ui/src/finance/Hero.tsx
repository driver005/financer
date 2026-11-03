import type { ReactNode } from "react";
import { View } from "react-native";

import { radius } from "../constants/radius";
import { opacity } from "../constants/misc";
import { size } from "../constants/sizes";
import { splitMoney, spokenMoney } from "../format";
import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { useTheme } from "../theme/ThemeProvider";

/**
 * The filled card at the top of a screen: one label, one big figure, an optional chip and chart.
 * Everything on it is drawn in the accent's "on solid" ink, so it reads in both themes. Use it once
 * per screen, for the number the screen is about.
 */
export function HeroCard({ label, chip, children }: { label: string; chip?: ReactNode; children?: ReactNode }) {
  return (
    <Box bg="accent-solid" radius="3xl" p="lg" gap="xs" overflow="hidden">
      <Row justify="between" gap="md">
        <Box grow>
          <Text variant="label" tone="on-accent-solid">{label}</Text>
        </Box>
        {chip}
      </Row>
      {children}
    </Box>
  );
}

/** A small pill on the card: an icon and a short text. */
export function HeroChip({ icon, text }: { icon?: IconName; text: string }) {
  return (
    <Row bg="accent-soft" radius="full" px="md" control="xs" gap="xs" fit>
      {icon ? <Icon name={icon} size="xs" tone="on-accent-soft" /> : null}
      <Text variant="badge" tone="on-accent-soft" numberOfLines={1}>{text}</Text>
    </Row>
  );
}

/** The big amount of a card: whole euros large, cents and the euro sign small. */
export function HeroFigure({ cents, label }: { cents: number; label?: string }) {
  const parts = splitMoney(cents);
  return (
    <Row gap="2xs" align="baseline" accessible accessibilityLabel={label ?? spokenMoney(cents)}>
      <Box shrink>
        <Text variant="display" tone="on-accent-solid" fit>{`${parts.sign}${parts.whole}`}</Text>
      </Box>
      <Text variant="subheading" tone="on-accent-solid">{`,${parts.fraction} €`}</Text>
    </Row>
  );
}

/** A plain count on the card (not money), with a small suffix such as `of 8`. */
export function HeroNumber({ value, suffix, label }: { value: string; suffix?: string; label?: string }) {
  return (
    <Row gap="sm" align="baseline" accessible accessibilityLabel={label ?? `${value} ${suffix ?? ""}`.trim()}>
      <Text variant="display" tone="on-accent-solid">{value}</Text>
      {suffix ? <Text variant="bodyStrong" tone="on-accent-solid">{suffix}</Text> : null}
    </Row>
  );
}

/** Secondary text on the card. */
export function HeroCaption({ children }: { children: ReactNode }) {
  return <Text variant="caption" tone="on-accent-solid">{children}</Text>;
}

/** A row of label/value pairs at the foot of a card, set off by a faint rule. */
export function HeroStats({ items }: { items: { label: string; value: string; spoken?: string }[] }) {
  const { colors } = useTheme();
  return (
    <Box gap="md" pt="md">
      <View style={{ height: size.stroke.sm, backgroundColor: colors.tones.accent.onSolid, opacity: opacity[25] }} />
      <Row gap="md" align="start">
        {items.map((it) => (
          <Box key={it.label} equal accessible accessibilityLabel={`${it.label}: ${it.spoken ?? it.value}`}>
            <Text variant="caption" tone="on-accent-solid" numberOfLines={1}>{it.label}</Text>
            <Text variant="number" tone="on-accent-solid" fit>{it.value}</Text>
          </Box>
        ))}
      </Row>
    </Box>
  );
}

/** A thin progress track in the card's ink. */
export function HeroProgress({ progress, label }: { progress: number; label: string }) {
  const { colors } = useTheme();
  const v = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const h = size.bar.md;
  const ink = colors.tones.accent.onSolid;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}
      style={{ height: h, borderRadius: radius.full, overflow: "hidden" }}
    >
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: ink, opacity: opacity[25] }} />
      <View style={{ width: `${v * 100}%`, height: h, borderRadius: radius.full, backgroundColor: ink }} />
    </View>
  );
}
