/**
 * Shared building blocks for lists and small status labels:
 * `ListGroup` (a flat strip of rows between two hairlines), `ListRow` (leading icon
 * or avatar, title, subtitle, trailing value, optional chevron), `IconBadge`, `StatusPill` and
 * `SectionHeader`. Screens compose these instead of hand-building each row.
 */
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from "react";
import { Pressable, Text as RNText, View, type StyleProp, type ViewStyle } from "react-native";

import { MIN_TOUCH } from "@/a11y";
import type { Palette } from "@/colors";
import { elevation, radius, space, typography, usePalette } from "@/theme";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export type Tone = "accent" | "good" | "bad" | "warn" | "blue" | "gold" | "muted";

/** Text/icon colour and pale background for a tone; every pair reaches 4.5:1 (tested in tests/theme.test.ts). */
export function toneColors(p: Palette, tone: Tone): { fg: string; bg: string } {
  switch (tone) {
    case "good":
      return { fg: p.good, bg: p.goodSoft };
    case "bad":
      return { fg: p.bad, bg: p.badSoft };
    case "warn":
      return { fg: p.warn, bg: p.warnSoft };
    case "blue":
      return { fg: p.blue, bg: p.blueSoft };
    case "gold":
      return { fg: p.goldText, bg: p.goldSoft };
    case "muted":
      return { fg: p.muted, bg: p.accentSoft };
    default:
      return { fg: p.accent, bg: p.accentSoft };
  }
}

/** A round tinted badge with an icon (or an emoji / text) in it. Decorative: hidden from screen readers. */
export function IconBadge({ icon, text, tone = "accent", size = 40 }: { icon?: string; text?: string; tone?: Tone; size?: number }) {
  const p = usePalette();
  const { fg, bg } = toneColors(p, tone);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}
    >
      {icon ? <MaterialCommunityIcons name={icon as IconName} size={Math.round(size * 0.5)} color={fg} /> : null}
      {text ? <RNText style={{ fontSize: Math.round(size * 0.46) }}>{text}</RNText> : null}
    </View>
  );
}

/** Small rounded label with an optional icon: `On track`, `Over pace`, `3 new`. */
export function StatusPill({ label, tone = "muted", icon, accessibilityLabel }: { label: string; tone?: Tone; icon?: string; accessibilityLabel?: string }) {
  const p = usePalette();
  const { fg, bg } = toneColors(p, tone);
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: space.xs,
        backgroundColor: bg,
        borderRadius: radius.pill,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
      }}
    >
      {icon ? <MaterialCommunityIcons name={icon as IconName} size={14} color={fg} /> : null}
      <RNText style={{ color: fg, fontSize: 13, lineHeight: 18, fontWeight: "800" }}>{label}</RNText>
    </View>
  );
}

/** Small heading above a block of rows; `action` goes on the right (a link or a count). */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.sm, marginBottom: space.sm, paddingHorizontal: space.xs, minHeight: 24 }}>
      <RNText accessibilityRole="header" style={[typography.overline, { color: p.muted, flexShrink: 1 }]}>
        {title}
      </RNText>
      {action}
    </View>
  );
}

/** A flat strip holding rows, closed by hairlines top and bottom. Rows are separated by an inset hairline. */
export function ListGroup({ children, style, inset = 68 }: { children: ReactNode; style?: StyleProp<ViewStyle>; inset?: number }) {
  const p = usePalette();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View
      style={[
        {
          backgroundColor: p.surface,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: p.border,
          marginBottom: space.lg,
        },
        style,
      ]}
    >
      {rows.map((row, i) => (
        <Fragment key={row.key ?? i}>
          {i > 0 ? <View style={{ height: 1, backgroundColor: p.border, marginLeft: inset }} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/**
 * One row: leading icon badge (or any `leading` node), title, subtitle, trailing `value` and a
 * chevron when it opens something. At least 56 high, so the whole row is a comfortable touch
 * target, and it grows with the text size. The value keeps its width (amounts are never cut off),
 * the title shrinks and wraps.
 */
export function ListRow({
  icon,
  iconTone = "accent",
  leading,
  title,
  subtitle,
  value,
  chevron,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  titleLines = 2,
  subtitleLines = 2,
}: {
  icon?: string;
  iconTone?: Tone;
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  value?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  titleLines?: number;
  subtitleLines?: number;
}) {
  const p = usePalette();
  const showChevron = chevron ?? !!onPress;
  const body = (
    <>
      {leading ?? (icon ? <IconBadge icon={icon} tone={iconTone} /> : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={titleLines} style={[typography.bodyStrong, { color: p.text }]}>
          {title}
        </RNText>
        {subtitle ? (
          <RNText numberOfLines={subtitleLines} style={[typography.caption, { color: p.muted, marginTop: 2 }]}>
            {subtitle}
          </RNText>
        ) : null}
      </View>
      {value ? <View style={{ flexShrink: 0, alignItems: "flex-end", maxWidth: "50%" }}>{typeof value === "string" ? <RNText style={[typography.bodyStrong, { color: p.text }]}>{value}</RNText> : value}</View> : null}
      {showChevron ? <MaterialCommunityIcons name="chevron-right" size={22} color={p.muted} /> : null}
    </>
  );
  const rowStyle: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: Math.max(56, MIN_TOUCH),
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  };
  if (!onPress) {
    return (
      <View style={rowStyle} accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [rowStyle, { backgroundColor: pressed ? p.accentSoft : "transparent" }]}
    >
      {body}
    </Pressable>
  );
}
