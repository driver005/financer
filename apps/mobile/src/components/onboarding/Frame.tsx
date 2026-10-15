import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, type ComponentProps, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text as RNText, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Mascot } from "@/components/Mascot";
import { ChunkyButton, Text } from "@/components/kit";
import { Bar, Page } from "@/components/ui";
import type { MascotLine } from "@/onboarding";
import { tap } from "@/native/haptics";
import { usePalette } from "@/theme";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

const MOOD_BADGE = { happy: null, cheer: "🎉", worried: "💦" } as const;

/**
 * The small Penny above the scrolling answers on a tall screen: the same look as `Mascot` at
 * about two thirds of the size, so the answers get more room, and it stands still when the
 * person has asked for less motion.
 */
function CompactMascot({ message, mood }: MascotLine) {
  const p = usePalette();
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      y.value = 0;
      return;
    }
    y.value = withRepeat(
      withSequence(withTiming(-4, { duration: 700, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 700, easing: Easing.inOut(Easing.quad) })),
      -1,
    );
  }, [reduce, y]);
  const bob = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const badge = MOOD_BADGE[mood];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          { width: 52, height: 52, borderRadius: 26, backgroundColor: p.fill, alignItems: "center", justifyContent: "center" },
          bob,
        ]}
      >
        <RNText style={{ fontSize: 28 }}>🐷</RNText>
        {badge ? <RNText style={{ position: "absolute", top: -6, right: -6, fontSize: 18 }}>{badge}</RNText> : null}
      </Animated.View>
      <View
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        style={{ flex: 1, borderWidth: 1, borderColor: p.border, borderRadius: 16, backgroundColor: p.surface, paddingVertical: 8, paddingHorizontal: 12 }}
      >
        <RNText style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{message}</RNText>
      </View>
    </View>
  );
}

/** "3/8" read out as "Step 3 of 8". */
export function spokenStep(label: string): string {
  const m = /^(\d+)\/(\d+)$/.exec(label);
  return m ? `Step ${m[1]} of ${m[2]}` : label;
}

/** Content never gets wider than a phone, so the web build looks the same on a big screen. */
const MAX_WIDTH = 560;

/**
 * One setup step: a thin progress bar with a back (or, on the first step, close) button, the
 * mascot's speech bubble, one question, and a footer that stays put with the main button and a
 * Skip. The body scrolls and keeps taps working while the keyboard is open.
 */
export function StepFrame({
  fraction,
  stepLabel,
  onBack,
  backIsClose,
  mascot,
  title,
  why,
  children,
  primary,
  onSkip,
  skipLabel = "Skip for now",
  footerExtra,
  confetti,
}: {
  fraction: number;
  stepLabel: string;
  onBack: () => void;
  /** First step: the button closes the setup instead of going back. */
  backIsClose?: boolean;
  mascot: MascotLine;
  title: string;
  /** Plain-language reason for the question, shown under the title. */
  why?: string;
  children: ReactNode;
  primary: { label: string; onPress: () => void; disabled?: boolean; icon?: string };
  onSkip?: () => void;
  skipLabel?: string;
  footerExtra?: ReactNode;
  confetti?: boolean;
}) {
  const p = usePalette();
  // On a tall screen the mascot stays above the scrolling answers, so its reaction to a tap is
  // always in view; on a short one it scrolls with the page to leave room for the question.
  const sticky = useWindowDimensions().height >= 700;
  const bubble = sticky ? <CompactMascot message={mascot.message} mood={mascot.mood} /> : <Mascot message={mascot.message} mood={mascot.mood} />;
  return (
    <Page edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ width: "100%", maxWidth: MAX_WIDTH, alignSelf: "center", paddingHorizontal: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8 }}>
            <Pressable
              onPress={() => {
                tap();
                onBack();
              }}
              accessibilityRole="button"
              accessibilityLabel={backIsClose ? "Close setup" : "Back"}
              hitSlop={8}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -8 }}
            >
              <MaterialCommunityIcons name={(backIsClose ? "close" : "arrow-left") as IconName} size={26} color={p.muted} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Bar progress={fraction} height={10} marginTop={0} />
            </View>
            <RNText style={{ color: p.muted, fontSize: 12, fontWeight: "800", minWidth: 36, textAlign: "right" }} accessibilityLabel={spokenStep(stepLabel)}>
              {stepLabel}
            </RNText>
          </View>
          {sticky ? <View style={{ paddingTop: 8, paddingBottom: 4 }}>{bubble}</View> : null}
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: sticky ? 4 : 16, paddingBottom: 16, width: "100%", maxWidth: MAX_WIDTH, alignSelf: "center" }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          showsVerticalScrollIndicator={false}
        >
          {sticky ? null : bubble}
          <Text variant="headlineSmall" style={{ fontWeight: "800", marginTop: 4 }} accessibilityRole="header">
            {title}
          </Text>
          {why ? (
            <Text variant="bodyMedium" style={{ color: p.muted, marginTop: 6 }}>
              {why}
            </Text>
          ) : null}
          <View style={{ marginTop: 16 }}>{children}</View>
        </ScrollView>

        <View
          style={{
            width: "100%",
            maxWidth: MAX_WIDTH,
            alignSelf: "center",
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 12,
            gap: 4,
            borderTopWidth: 2,
            borderTopColor: p.border,
            backgroundColor: p.background,
          }}
        >
          {footerExtra}
          <ChunkyButton label={primary.label} icon={primary.icon} onPress={primary.onPress} disabled={primary.disabled} />
          {onSkip ? <ChunkyButton flat label={skipLabel} onPress={onSkip} /> : null}
        </View>
      </KeyboardAvoidingView>
      {confetti ? <Confetti /> : null}
    </Page>
  );
}

/** A big tappable answer: a titled card that gets the accent border when chosen. */
export function ChoiceCard({
  title,
  body,
  icon,
  selected,
  onPress,
  disabled,
  note,
  role = "radio",
  children,
}: {
  title: string;
  body?: string;
  icon: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** A line under the text, e.g. why the choice is not available. */
  note?: string;
  role?: "radio" | "checkbox";
  children?: ReactNode;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        tap();
        onPress();
      }}
      accessibilityRole={role}
      accessibilityLabel={title}
      accessibilityHint={body}
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      style={{
        flexDirection: "row",
        gap: 12,
        padding: 14,
        marginBottom: 10,
        borderRadius: 20,
        borderWidth: 1,
        borderBottomWidth: 1,
        borderColor: selected ? p.accent : p.border,
        backgroundColor: selected ? p.surfaceAlt : p.surface,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: selected ? p.accent : p.surfaceAlt,
        }}
      >
        <MaterialCommunityIcons name={icon as IconName} size={24} color={selected ? p.onAccent : p.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText style={{ color: p.text, fontSize: 17, fontWeight: "800" }}>{title}</RNText>
        {body ? <RNText style={{ color: p.muted, fontSize: 14, marginTop: 4 }}>{body}</RNText> : null}
        {note ? <RNText style={{ color: p.muted, fontSize: 13, fontWeight: "700", marginTop: 6 }}>{note}</RNText> : null}
        {children}
      </View>
      <MaterialCommunityIcons
        name={(role === "radio" ? (selected ? "radiobox-marked" : "radiobox-blank") : selected ? "checkbox-marked" : "checkbox-blank-outline") as IconName}
        size={24}
        color={selected ? p.accent : p.border}
      />
    </Pressable>
  );
}

/** A row of round number tiles to pick from (household size and the like). */
export function NumberTiles({
  values,
  value,
  onChange,
  label,
}: {
  values: number[];
  value: number | undefined;
  onChange: (n: number) => void;
  label: (n: number) => string;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup">
      {values.map((n) => {
        const on = n === value;
        return (
          <Pressable
            key={n}
            onPress={() => {
              tap();
              onChange(n);
            }}
            accessibilityRole="radio"
            accessibilityLabel={label(n)}
            accessibilityState={{ checked: on }}
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderBottomWidth: 1,
              borderColor: on ? p.accent : p.border,
              backgroundColor: on ? p.accent : p.surface,
            }}
          >
            <RNText style={{ color: on ? p.onAccent : p.text, fontWeight: "800", fontSize: 18 }}>{n}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A pill you can switch on and off (stores, for example): at least 44 high, a check mark when on. */
export function ToggleChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 16,
        borderRadius: 22,
        borderWidth: 1,
        borderBottomWidth: 1,
        borderColor: selected ? p.accent : p.border,
        backgroundColor: selected ? p.accent : p.surface,
      }}
    >
      {selected ? <MaterialCommunityIcons name="check" size={18} color={p.onAccent} /> : null}
      <RNText style={{ color: selected ? p.onAccent : p.text, fontSize: 15, fontWeight: "800" }}>{label}</RNText>
    </Pressable>
  );
}

/** A small label above a group of answers. */
export function FieldLabel({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <RNText accessibilityRole="header" style={{ color: p.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginTop: 16, marginBottom: 8 }}>
      {children}
    </RNText>
  );
}

/** A short box with a heading, for the "why we ask" and security notes. */
export function Note({ icon, children }: { icon: string; children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", gap: 10, padding: 12, borderRadius: 16, backgroundColor: p.surfaceAlt, borderWidth: 1, borderColor: p.border, marginTop: 8 }}>
      <MaterialCommunityIcons name={icon as IconName} size={20} color={p.accent} style={{ marginTop: 1 }} />
      <RNText style={{ flex: 1, color: p.muted, fontSize: 13 }}>{children}</RNText>
    </View>
  );
}

const CONFETTI_COUNT = 28;

function Piece({ index, height }: { index: number; height: number }) {
  const p = usePalette();
  const y = useSharedValue(-40);
  const spin = useSharedValue(0);
  const colours = [p.fill, p.gold, p.blue, p.orange, p.good];
  useEffect(() => {
    const duration = 2400 + (index % 5) * 350;
    const delay = (index * 70) % 1200;
    y.value = withDelay(delay, withTiming(height + 40, { duration, easing: Easing.in(Easing.quad) }));
    spin.value = withDelay(delay, withRepeat(withTiming(360, { duration: 900 + (index % 4) * 200, easing: Easing.linear }), -1));
  }, [index, height, y, spin]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }, { rotate: `${spin.value}deg` }] }));
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: 0,
          left: `${(index * 37) % 96}%`,
          width: 8 + (index % 3) * 3,
          height: 12 + (index % 4) * 3,
          borderRadius: 2,
          backgroundColor: colours[index % colours.length],
        },
        style,
      ]}
    />
  );
}

/** Confetti-like pieces falling once. Not drawn when the person has asked for less motion. */
export function Confetti() {
  const { height } = useWindowDimensions();
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: CONFETTI_COUNT }, (_, i) => (
        <Piece key={i} index={i} height={height} />
      ))}
    </View>
  );
}
