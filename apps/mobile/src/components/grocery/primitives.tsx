/**
 * Small building blocks of the grocery screens (prices, scan, recipes, meal plan, usual items,
 * receipts), kept apart from the shared kit so they can evolve without touching it. Everything
 * reads colours from the palette; money uses tabular numerals so columns line up.
 *
 * Spacing is on a 4/8 grid (`space`), touch targets are at least 44, and every animation checks
 * the system's reduce-motion setting first.
 */
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Children, Fragment, useEffect, type ComponentProps, type ReactNode } from "react";
import { Pressable, Text as RNText, View, useColorScheme, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { Mascot } from "@/components/Mascot";
import { ChunkyButton, Text } from "@/components/kit";
import type { Mood } from "@/game";
import { blend, toneColours, type Tint, type ToneName } from "@/groceryView";
import { usePalette } from "@/theme";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

/** 4/8 spacing and the corner radii used on these screens. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { sm: 12, md: 16, lg: 24 } as const;
export const MIN_TARGET = 44;

const TABULAR = ["tabular-nums"] as const;

/** Status colours (text, tint, border) for the active light or dark scheme. */
export function useTones() {
  const p = usePalette();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return toneColours(scheme, p.surface);
}

// ---- text ----

/** An amount of money; `cents` goes through the caller's formatter so the notation stays in one place. */
export function Money({
  text,
  size = "md",
  color,
  strike,
  bold = true,
}: {
  text: string;
  size?: "sm" | "md" | "lg" | "xl";
  color?: string;
  strike?: boolean;
  bold?: boolean;
}) {
  const p = usePalette();
  const fontSize = { sm: 13, md: 16, lg: 20, xl: 32 }[size];
  return (
    <RNText
      style={{
        color: color ?? p.text,
        fontSize,
        fontWeight: bold ? "800" : "500",
        fontVariant: [...TABULAR],
        textDecorationLine: strike ? "line-through" : "none",
      }}
    >
      {text}
    </RNText>
  );
}

/** Small upper-case label above a group, with an optional note on the right. */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: space.sm, marginBottom: space.sm, gap: space.sm }}>
      <RNText
        accessibilityRole="header"
        style={{ flex: 1, color: p.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }}
      >
        {children}
      </RNText>
      {right}
    </View>
  );
}

// ---- surfaces ----

/** A card: surface colour, 2px border, 24px corners. `tone` tints it for a verdict. */
export function Panel({
  children,
  tone,
  style,
  padding = space.lg,
}: {
  children: ReactNode;
  tone?: ToneName;
  style?: StyleProp<ViewStyle>;
  padding?: number;
}) {
  const p = usePalette();
  const tones = useTones();
  return (
    <View
      style={[
        {
          backgroundColor: tone ? tones[tone].bg : p.surface,
          borderColor: tone ? tones[tone].border : p.border,
          borderWidth: 1,
          borderRadius: radius.lg,
          padding,
          marginBottom: space.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Rows in one rounded card with hairline dividers (a grouped list). */
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View
      style={[
        {
          backgroundColor: p.surface,
          borderColor: p.border,
          borderWidth: 1,
          borderRadius: radius.lg,
          overflow: "hidden",
          marginBottom: space.md,
        },
        style,
      ]}
    >
      {rows.map((row, i) => (
        <Fragment key={i}>
          {i > 0 ? <View style={{ height: 2, backgroundColor: p.border, marginLeft: space.lg }} /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/** Pressable with a quiet press state (a small shrink, no animation to switch off). */
export function Tap({ style, children, ...rest }: Omit<PressableProps, "style"> & { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      style={({ pressed }) => [{ minHeight: MIN_TARGET, opacity: rest.disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }, style]}
    >
      {children}
    </Pressable>
  );
}

// ---- small marks ----

/** A round or rounded avatar with a letter; colours come from `chainTint` / `mealTint`. */
export function Avatar({ tint, label, size = 40, square }: { tint: Tint; label: string; size?: number; square?: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: square ? 14 : size / 2,
        backgroundColor: tint.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <RNText style={{ color: tint.fg, fontSize: size * 0.42, fontWeight: "800" }} allowFontScaling={false}>
        {label}
      </RNText>
    </View>
  );
}

/** A small pill: "Offer", "Cheapest", "Check". */
export function Badge({ label, tone = "accent", icon }: { label: string; tone?: ToneName | "muted"; icon?: string }) {
  const p = usePalette();
  const tones = useTones();
  const colours = tone === "muted" ? { fg: p.muted, bg: p.surfaceAlt, border: p.border } : tones[tone];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        alignSelf: "flex-start",
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: colours.bg,
      }}
    >
      {icon ? <MaterialCommunityIcons name={icon as IconName} size={12} color={colours.fg} /> : null}
      <RNText style={{ color: colours.fg, fontSize: 12, fontWeight: "800" }}>{label}</RNText>
    </View>
  );
}

/** Match percentage as a ring with the number inside. */
export function MatchRing({ percent, size = 52, label }: { percent: number; size?: number; label?: string }) {
  const p = usePalette();
  const tones = useTones();
  const clamped = Math.max(0, Math.min(100, percent));
  const colour = clamped >= 75 ? tones.good.fg : clamped >= 40 ? tones.accent.fg : p.muted;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label ?? `${clamped} percent of the ingredients`}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={p.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colour}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          strokeDashoffset={c * (1 - clamped / 100)}
          rotation={-90}
          originX={size / 2}
          originY={size / 2}
        />
      </Svg>
      <RNText allowFontScaling={false} style={{ color: p.text, fontSize: size * 0.27, fontWeight: "800", fontVariant: [...TABULAR] }}>
        {clamped}%
      </RNText>
    </View>
  );
}

/** A checkbox that pops when it is ticked (no pop when the system asks for reduced motion). */
export function Checkbox({ checked, size = 28 }: { checked: boolean; size?: number }) {
  const p = usePalette();
  const reduce = useReducedMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (reduce || !checked) {
      scale.value = 1;
      return;
    }
    scale.value = withSequence(withTiming(0.8, { duration: 70 }), withSpring(1, { damping: 7, stiffness: 260 }));
  }, [checked, reduce, scale]);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: 9,
          borderWidth: 1,
          borderColor: checked ? p.accent : p.muted,
          backgroundColor: checked ? p.accent : "transparent",
          alignItems: "center",
          justifyContent: "center",
        },
        pop,
      ]}
    >
      {checked ? <MaterialCommunityIcons name="check" size={size - 8} color={p.onAccent} /> : null}
    </Animated.View>
  );
}

/** Minus, number, plus: for servings and quantities. Both buttons are 44 wide and tall. */
export function Stepper({
  value,
  unit,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
  minusIcon = "minus",
}: {
  value: number;
  unit?: string;
  onMinus: () => void;
  onPlus: () => void;
  minusLabel: string;
  plusLabel: string;
  /** `delete-outline` when the next press removes the line. */
  minusIcon?: string;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        backgroundColor: p.surfaceAlt,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: p.border,
      }}
    >
      <Tap onPress={onMinus} accessibilityLabel={minusLabel} style={{ width: MIN_TARGET, alignItems: "center", justifyContent: "center" }} hitSlop={4}>
        <MaterialCommunityIcons name={minusIcon as IconName} size={20} color={p.accent} />
      </Tap>
      <RNText
        accessibilityLiveRegion="polite"
        style={{ minWidth: 28, textAlign: "center", color: p.text, fontSize: 15, fontWeight: "800", fontVariant: [...TABULAR] }}
      >
        {value}
        {unit ? <RNText style={{ color: p.muted, fontSize: 13, fontWeight: "600" }}>{` ${unit}`}</RNText> : null}
      </RNText>
      <Tap onPress={onPlus} accessibilityLabel={plusLabel} style={{ width: MIN_TARGET, alignItems: "center", justifyContent: "center" }} hitSlop={4}>
        <MaterialCommunityIcons name="plus" size={20} color={p.accent} />
      </Tap>
    </View>
  );
}

/** A filter chip: 36 high with a 4px hit slop above and below, so the target is 44. */
export function FilterChip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  icon?: string;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({
        height: 36,
        flexDirection: "row",
        gap: space.xs,
        paddingHorizontal: space.lg,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: selected ? p.accent : p.surface,
        borderWidth: 1,
        borderColor: selected ? p.accent : p.border,
        transform: [{ scale: pressed ? 0.96 : 1 }],
      })}
    >
      {icon ? <MaterialCommunityIcons name={icon as IconName} size={14} color={selected ? p.onAccent : p.muted} /> : null}
      <RNText style={{ color: selected ? p.onAccent : p.text, fontSize: 14, fontWeight: "700" }}>{label}</RNText>
    </Pressable>
  );
}

/** A round icon button, 44 by 44. */
export function RoundIcon({
  icon,
  onPress,
  label,
  tone,
}: {
  icon: string;
  onPress: () => void;
  label: string;
  tone?: "muted" | "bad";
}) {
  const p = usePalette();
  const tones = useTones();
  return (
    <Tap onPress={onPress} accessibilityLabel={label} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center", borderRadius: MIN_TARGET / 2 }}>
      <MaterialCommunityIcons name={icon as IconName} size={22} color={tone === "bad" ? tones.bad.fg : p.muted} />
    </Tap>
  );
}

// ---- loading and empty ----

/** A grey block that pulses while data loads (still, if reduced motion is on). */
export function Skeleton({ height = 16, width, radius: r = 8, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  const reduce = useReducedMotion();
  const o = useSharedValue(reduce ? 0.7 : 1);
  useEffect(() => {
    if (reduce) {
      o.value = 0.7;
      return;
    }
    o.value = withRepeat(withSequence(withTiming(0.45, { duration: 800, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 800, easing: Easing.inOut(Easing.quad) })), -1);
  }, [reduce, o]);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ height, width: width ?? "100%", borderRadius: r, backgroundColor: blend(p.muted, p.surface, 0.18) }, pulse, style]} />;
}

/** Placeholder cards that look like the list that is coming. */
export function SkeletonCards({ count = 3, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} importantForAccessibility="yes">
      {Array.from({ length: count }, (_, i) => (
        <Panel key={i}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Skeleton height={40} width={40} radius={20} />
            <View style={{ flex: 1, gap: space.sm }}>
              <Skeleton height={16} width="60%" />
              <Skeleton height={12} width="85%" />
            </View>
          </View>
        </Panel>
      ))}
    </View>
  );
}

/** The pig says what is missing and there is one thing to do about it. */
export function EmptyState({
  title,
  body,
  mood = "happy",
  actionLabel,
  actionIcon,
  onAction,
}: {
  title: string;
  body?: string;
  mood?: Mood;
  actionLabel?: string;
  actionIcon?: string;
  onAction?: () => void;
}) {
  const p = usePalette();
  return (
    <View style={{ paddingVertical: space.lg }}>
      <Mascot message={title} mood={mood} />
      {body ? <RNText style={{ color: p.muted, fontSize: 15, lineHeight: 22, marginBottom: space.lg }}>{body}</RNText> : null}
      {actionLabel && onAction ? <ChunkyButton label={actionLabel} icon={actionIcon} onPress={onAction} /> : null}
    </View>
  );
}

/** One line under the screen title (put it right after `Title`), so the screen says what it is for. */
export function Subtitle({ children }: { children: ReactNode }) {
  return (
    <Text variant="bodyMedium" className="text-muted" style={{ marginTop: -space.sm, marginBottom: space.md }}>
      {children}
    </Text>
  );
}
