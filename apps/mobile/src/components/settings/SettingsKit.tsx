/**
 * Building blocks for the Settings screen (and the small list screens next to it): section
 * headers, grouped rows, expandable panels, toggle rows, inline messages, a confirm-first danger
 * action and an empty state. They only use the colour tokens from `theme.ts` and the shared
 * `kit` primitives; nothing here changes them.
 *
 * Sizes follow a 4/8 grid. Every row is at least 56 high and every tappable thing at least 44,
 * heights are minimums (never fixed), so larger system text pushes the layout down instead of
 * clipping it.
 */
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState, type ComponentProps, type ReactNode } from "react";
import { Pressable, Text as RNText, View, useColorScheme, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { Mascot } from "@/components/Mascot";
import { ChunkyButton, Switch } from "@/components/kit";
import type { Mood } from "@/game";
import { tap } from "@/native/haptics";
import { usePalette } from "@/theme";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

/**
 * Text colours for errors and success that reach 4.5:1 on the card colour in both themes. The
 * theme's `bad` (#ea2b2b) is 4.3:1 on white and `good` (#16a34a) 3.3:1, fine for fills but not for
 * small text.
 */
export function useInk() {
  const p = usePalette();
  const dark = useColorScheme() === "dark";
  return {
    danger: dark ? p.bad : "#c81e1e",
    dangerFace: dark ? p.bad : "#c81e1e",
    dangerEdge: dark ? "#b84a4a" : "#8f1414",
    onDanger: dark ? "#2a0606" : "#ffffff",
    success: dark ? p.good : "#15803d",
  };
}

// ---------------------------------------------------------------- sections and groups

/** Small uppercase heading above a group of rows. */
export function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  const p = usePalette();
  return (
    <View style={{ marginTop: 24, marginBottom: 8, paddingHorizontal: 4 }}>
      <RNText accessibilityRole="header" style={{ color: p.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }}>
        {title}
      </RNText>
      {hint ? <RNText style={{ color: p.muted, fontSize: 13, marginTop: 2 }}>{hint}</RNText> : null}
    </View>
  );
}

/** Small text under a group, for the one thing that is worth knowing about it. */
export function SectionFootnote({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <RNText style={{ color: p.muted, fontSize: 13, marginTop: 8, paddingHorizontal: 4 }}>{children}</RNText>;
}

/**
 * A rounded box whose rows are separated by hairlines. Each row draws its own bottom line; the
 * box pulls its content 1px down so the last line is clipped, which also works when some of the
 * children render nothing (the app lock row on the web, say).
 */
export function SettingsGroup({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <View style={[{ borderRadius: 20, borderWidth: 2, borderColor: p.border, backgroundColor: p.surface, overflow: "hidden" }, style]}>
      <View style={{ marginBottom: -1 }}>{children}</View>
    </View>
  );
}

function IconTile({ icon, tone }: { icon: string; tone?: "danger" }) {
  const p = usePalette();
  const ink = useInk();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: p.surfaceAlt }}
    >
      <MaterialCommunityIcons name={icon as IconName} size={20} color={tone === "danger" ? ink.danger : p.accent} />
    </View>
  );
}

/**
 * One row: icon, title, an optional subtitle and value, and a chevron when it opens something.
 * Without `onPress` it is plain read-only information.
 */
export function SettingsRow({
  icon,
  title,
  subtitle,
  value,
  onPress,
  trailing,
  chevron,
  accessibilityHint,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  tone,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  /** Current value, shown on the right in a muted colour. */
  value?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  /** Defaults to true when the row can be pressed and has no `trailing`. */
  chevron?: boolean | "down" | "up";
  accessibilityHint?: string;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link" | "switch";
  accessibilityState?: { expanded?: boolean; checked?: boolean; disabled?: boolean };
  tone?: "danger";
}) {
  const p = usePalette();
  const ink = useInk();
  const showChevron = chevron ?? (onPress !== undefined && trailing === undefined);
  const chevronName = chevron === "down" ? "chevron-down" : chevron === "up" ? "chevron-up" : "chevron-right";
  const body = (
    <>
      <IconTile icon={icon} tone={tone} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText style={{ color: tone === "danger" ? ink.danger : p.text, fontSize: 16, fontWeight: "700" }}>{title}</RNText>
        {subtitle ? <RNText style={{ color: p.muted, fontSize: 13, marginTop: 2 }}>{subtitle}</RNText> : null}
      </View>
      {value ? (
        <RNText style={{ color: p.muted, fontSize: 14, maxWidth: "42%", textAlign: "right" }} numberOfLines={2}>
          {value}
        </RNText>
      ) : null}
      {trailing}
      {showChevron ? <MaterialCommunityIcons name={chevronName} size={22} color={p.muted} /> : null}
    </>
  );
  const rowStyle = {
    minHeight: 56,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: p.border,
  };
  if (!onPress) {
    return (
      <View style={rowStyle} accessible accessibilityLabel={accessibilityLabel ?? [title, value, subtitle].filter(Boolean).join(", ")}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole={accessibilityRole ?? "button"}
      accessibilityLabel={accessibilityLabel ?? [title, value, subtitle].filter(Boolean).join(", ")}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      aria-expanded={accessibilityState?.expanded}
      style={({ pressed }) => [rowStyle, { backgroundColor: pressed ? p.surfaceAlt : "transparent" }]}
    >
      {body}
    </Pressable>
  );
}

/** A row with a switch. The whole row is the tap target; the switch itself is only a picture of the state. */
export function SettingsToggleRow({
  icon,
  title,
  subtitle,
  note,
  value,
  onValueChange,
  disabled,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  /** Extra line under the subtitle, e.g. "Next: 18.10.2026". */
  note?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        tap();
        onValueChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: p.border,
        backgroundColor: pressed ? p.surfaceAlt : "transparent",
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <IconTile icon={icon} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{title}</RNText>
        {subtitle ? <RNText style={{ color: p.muted, fontSize: 13, marginTop: 2 }}>{subtitle}</RNText> : null}
        {note ? <RNText style={{ color: p.muted, fontSize: 13, marginTop: 2 }}>{note}</RNText> : null}
      </View>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Switch value={value} onValueChange={() => {}} accessibilityLabel={title} />
      </View>
    </Pressable>
  );
}

/**
 * A row that opens in place: the header looks like `SettingsRow`, the body (a form, a longer
 * explanation) shows underneath when it is open. No animation, so nothing moves for people who
 * asked for less motion.
 */
export function SettingsPanel({
  icon,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  icon: string;
  title: string;
  /** Current state in a few words, shown while it is closed and open. */
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const p = usePalette();
  const dark = useColorScheme() === "dark";
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View>
      <SettingsRow
        icon={icon}
        title={title}
        subtitle={summary}
        onPress={() => setOpen(!open)}
        chevron={open ? "up" : "down"}
        accessibilityState={{ expanded: open }}
      />
      {open ? (
        // In dark mode the form sits on the page colour so the inputs (card colour) stand out from it.
        <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: p.border, backgroundColor: dark ? p.background : p.surface }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

/** Explanation text inside a panel. */
export function PanelText({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const p = usePalette();
  return <RNText style={[{ color: p.muted, fontSize: 13, marginTop: 8 }, style]}>{children}</RNText>;
}

/** Thin line with space around it, to split a panel into parts. */
export function PanelDivider() {
  const p = usePalette();
  return <View style={{ height: 1, backgroundColor: p.border, marginVertical: 16 }} />;
}

// ---------------------------------------------------------------- messages

/** Inline message for a form: red for a problem, green for a success, muted otherwise. */
export function FieldMessage({ tone = "info", children }: { tone?: "error" | "ok" | "info"; children: ReactNode }) {
  const p = usePalette();
  const ink = useInk();
  const color = tone === "error" ? ink.danger : tone === "ok" ? ink.success : p.muted;
  const icon = tone === "error" ? "alert-circle-outline" : tone === "ok" ? "check-circle-outline" : "information-outline";
  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : undefined}
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", gap: 8, marginTop: 8, alignItems: "flex-start" }}
    >
      <MaterialCommunityIcons name={icon as IconName} size={18} color={color} style={{ marginTop: 1 }} />
      <RNText style={{ flex: 1, color, fontSize: 13 }}>{children}</RNText>
    </View>
  );
}

/** Messages and explanations that belong to the row above them (same box, no icon). */
export function RowNotes({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <View style={{ paddingHorizontal: 16, paddingTop: 0, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: p.border }}>{children}</View>;
}

// ---------------------------------------------------------------- jump chips

/** Table of contents: a row of chips that jump to a section. */
export function SectionChips({ sections, onSelect }: { sections: readonly { id: string; title: string }[]; onSelect: (id: string) => void }) {
  const p = usePalette();
  return (
    <View accessibilityRole="menu" accessibilityLabel="Jump to a section" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {sections.map((s) => (
        <Pressable
          key={s.id}
          onPress={() => {
            tap();
            onSelect(s.id);
          }}
          accessibilityRole="menuitem"
          accessibilityLabel={`Jump to ${s.title}`}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 16,
            borderRadius: 22,
            borderWidth: 2,
            borderColor: p.border,
            backgroundColor: pressed ? p.surfaceAlt : p.surface,
            alignItems: "center",
            justifyContent: "center",
          })}
        >
          <RNText style={{ color: p.accent, fontSize: 14, fontWeight: "800" }}>{s.title}</RNText>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- destructive actions

/** Solid or outlined red button with the 3D lip of the other buttons; contrast checked in both themes. */
export function DangerButton({
  label,
  onPress,
  icon,
  solid,
  disabled,
}: {
  label: string;
  onPress: () => void;
  icon?: string;
  solid?: boolean;
  disabled?: boolean;
}) {
  const p = usePalette();
  const ink = useInk();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 18,
        borderRadius: 16,
        backgroundColor: solid ? ink.dangerFace : p.surface,
        borderWidth: solid ? 0 : 2,
        borderColor: ink.danger,
        borderBottomWidth: 4 - (pressed ? 4 : 0),
        borderBottomColor: solid ? ink.dangerEdge : ink.danger,
        marginTop: pressed ? 4 : 0,
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {icon ? <MaterialCommunityIcons name={icon as IconName} size={20} color={solid ? ink.onDanger : ink.danger} /> : null}
      <RNText style={{ color: solid ? ink.onDanger : ink.danger, fontWeight: "800", fontSize: 15, letterSpacing: 0.8, textTransform: "uppercase" }}>
        {label}
      </RNText>
    </Pressable>
  );
}

/**
 * A destructive action that asks first: the button turns into a question with the consequence
 * spelled out, a red confirm button and a Cancel.
 */
export function ConfirmAction({
  label,
  icon,
  question,
  consequence,
  confirmLabel,
  onConfirm,
  disabled,
}: {
  label: string;
  icon?: string;
  question: string;
  consequence: string;
  confirmLabel: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const ink = useInk();
  const p = usePalette();
  const [armed, setArmed] = useState(false);
  if (!armed) return <DangerButton label={label} icon={icon} onPress={() => setArmed(true)} disabled={disabled} />;
  return (
    <View
      accessibilityRole="alert"
      style={{ borderRadius: 16, borderWidth: 2, borderColor: ink.danger, padding: 16, backgroundColor: p.surface, gap: 8 }}
    >
      <RNText style={{ color: p.text, fontSize: 16, fontWeight: "800" }}>{question}</RNText>
      <RNText style={{ color: p.muted, fontSize: 14 }}>{consequence}</RNText>
      <View style={{ gap: 4, marginTop: 4 }}>
        <DangerButton
          solid
          label={confirmLabel}
          icon={icon}
          onPress={() => {
            setArmed(false);
            onConfirm();
          }}
        />
        <ChunkyButton flat label="Cancel" onPress={() => setArmed(false)} />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- small controls

/** Icon-only button with a 44x44 touch area (the shared `IconButton` is smaller). */
export function IconAction({
  icon,
  label,
  onPress,
  disabled,
  tone,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "danger";
}) {
  const p = usePalette();
  const ink = useInk();
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? p.surfaceAlt : "transparent",
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <MaterialCommunityIcons name={icon as IconName} size={22} color={tone === "danger" ? ink.danger : p.muted} />
    </Pressable>
  );
}

/** Mutually exclusive options, like the shared `SegmentedButtons` but at least 48 high. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  buttons,
  style,
}: {
  value: T;
  onValueChange: (v: T) => void;
  buttons: { value: T; label: string; icon?: string }[];
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: "row", gap: 8 }, style]} accessibilityRole="radiogroup">
      {buttons.map((b) => (
        <ChunkyButton
          key={b.value}
          compact
          outline={b.value !== value}
          label={b.label}
          icon={b.icon}
          style={{ flex: 1, minHeight: 48 }}
          onPress={() => onValueChange(b.value)}
          accessibilityRole="radio"
          accessibilityState={{ checked: b.value === value }}
        />
      ))}
    </View>
  );
}

/** Pick one of several short options as wrapping pills, each at least 44 high. */
export function ChoiceChips({
  options,
  value,
  onChange,
  groupLabel,
}: {
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
  groupLabel: string;
}) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={groupLabel}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={o}
            onPress={() => {
              if (on) return;
              tap();
              onChange(o);
            }}
            accessibilityRole="radio"
            accessibilityLabel={o}
            accessibilityState={{ checked: on }}
            style={{
              minHeight: 44,
              paddingHorizontal: 14,
              borderRadius: 22,
              borderWidth: 2,
              borderColor: on ? p.accent : p.border,
              backgroundColor: on ? p.accent : p.surface,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <RNText style={{ color: on ? p.onAccent : p.text, fontSize: 14, fontWeight: "700" }}>{o}</RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------- empty state

/** An empty list that says what the list is for and what to do: the mascot talks, a line explains. */
export function EmptyState({ title, body, mood = "happy", children }: { title: string; body: string; mood?: Mood; children?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ marginTop: 16 }}>
      <Mascot message={title} mood={mood} />
      <RNText style={{ color: p.muted, fontSize: 14, marginBottom: 12 }}>{body}</RNText>
      {children}
    </View>
  );
}
