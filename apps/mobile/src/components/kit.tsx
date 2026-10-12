/**
 * The few UI primitives the screens use, built on HeroUI Native (Tailwind classes via
 * Uniwind). Screens import from here, so the look can change without touching them.
 */
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  Accordion,
  Button,
  Chip as HChip,
  Input,
  Label,
  SearchField,
  Spinner,
  Switch as HSwitch,
  TextField,
  useToast,
} from "heroui-native";
import { Children, useEffect, type ComponentProps, type ReactNode } from "react";
import {
  Pressable,
  Text as RNText,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { twMerge } from "tailwind-merge";

import { MIN_TOUCH } from "@/a11y";
import { tap } from "@/native/haptics";
import { radius, usePalette } from "@/theme";

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

const VARIANT_CLASS = {
  display: "text-5xl font-black text-foreground",
  caption: "text-[13px] text-foreground",
  headlineMedium: "text-3xl font-bold text-foreground",
  headlineSmall: "text-2xl font-bold text-foreground",
  titleLarge: "text-xl font-semibold text-foreground",
  titleSmall: "text-base font-semibold text-foreground",
  titleMedium: "text-lg font-semibold text-foreground",
  bodyLarge: "text-base text-foreground",
  bodyMedium: "text-sm text-foreground",
  bodySmall: "text-xs text-foreground",
} as const;

export function Text({
  variant = "bodyMedium",
  className,
  ...rest
}: TextProps & { variant?: keyof typeof VARIANT_CLASS; className?: string; style?: StyleProp<TextStyle> }) {
  return <RNText className={twMerge(VARIANT_CLASS[variant], className)} {...rest} />;
}

/** Small status line under a form: red for errors, muted otherwise. */
export function HelperText({
  type = "info",
  visible = true,
  children,
}: {
  type?: "info" | "error";
  visible?: boolean;
  children?: ReactNode;
}) {
  if (!visible) return null;
  return (
    <RNText
      className={`mt-1 text-sm ${type === "error" ? "text-danger" : "text-muted"}`}
      accessibilityRole={type === "error" ? "alert" : undefined}
    >
      {children}
    </RNText>
  );
}

function Affix({ text }: { text: string }) {
  return <RNText className="ml-2 text-base text-muted">{text}</RNText>;
}

export function TextInput({
  label,
  right,
  style,
  error,
  dense: _dense,
  mode: _mode,
  ...rest
}: TextInputProps & {
  label?: string;
  right?: ReactNode;
  error?: boolean;
  dense?: boolean;
  mode?: "outlined" | "flat";
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TextField isInvalid={error} style={style}>
      {label ? <Label>{label}</Label> : null}
      <View className="min-w-0 flex-row items-center">
        <Input
          containerClassName="min-w-0 flex-1"
          className="min-w-0 flex-1"
          accessibilityLabel={rest.accessibilityLabel ?? label}
          {...rest}
        />
        {right}
      </View>
    </TextField>
  );
}
TextInput.Affix = Affix;

export function Searchbar({
  placeholder,
  accessibilityLabel,
  value,
  onChangeText,
  style,
}: {
  placeholder?: string;
  accessibilityLabel?: string;
  value: string;
  onChangeText: (v: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SearchField value={value} onChange={onChangeText} style={style}>
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input placeholder={placeholder} accessibilityLabel={accessibilityLabel ?? placeholder} />
        <SearchField.ClearButton />
      </SearchField.Group>
    </SearchField>
  );
}

export function Switch({
  value,
  onValueChange,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel?: string;
}) {
  return <HSwitch isSelected={value} onSelectedChange={onValueChange} accessibilityLabel={accessibilityLabel} />;
}

export function ActivityIndicator({
  style,
  accessibilityLabel,
}: {
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <View style={style} accessibilityLabel={accessibilityLabel} accessibilityRole="progressbar">
      <Spinner />
    </View>
  );
}

/** A label that is allowed to be several JSX expressions; HeroUI wants one string. */
function asLabel(children: ReactNode): ReactNode {
  const parts = Children.toArray(children);
  return parts.every((p) => typeof p === "string" || typeof p === "number") ? parts.join("") : children;
}

export function Chip({
  children,
  selected,
  compact,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  selected?: boolean;
  compact?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <HChip
      size={compact ? "sm" : "md"}
      variant={selected ? "primary" : "soft"}
      color={selected ? "accent" : "default"}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={onPress ? { selected: !!selected } : undefined}
    >
      {asLabel(children)}
    </HChip>
  );
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: string;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  const p = usePalette();
  return (
    <Button
      isIconOnly
      size="sm"
      variant="ghost"
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      style={{ minWidth: MIN_TOUCH, minHeight: MIN_TOUCH }}
    >
      <MaterialCommunityIcons name={icon as IconName} size={22} color={p.muted} />
    </Button>
  );
}

/**
 * Chunky game-style button: a coloured face with a darker 3D lip that squashes when pressed.
 * `tone` picks the colours; `outline` is a white face with a grey lip.
 */
export function ChunkyButton({
  label,
  onPress,
  disabled,
  icon,
  tone = "green",
  outline,
  compact,
  flat,
  style,
  accessibilityRole = "button",
  accessibilityState,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  label: string;
  onPress?: () => void;
  icon?: string;
  tone?: "green" | "blue" | "red";
  outline?: boolean;
  /** Smaller padding, for rows. */
  compact?: boolean;
  /** No lip and no face: a plain text button. */
  flat?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const colours = {
    green: { face: p.accent, edge: p.accentEdge, text: p.onAccent, ink: p.accent },
    blue: { face: p.blue, edge: p.blueEdge, text: p.onBlue, ink: p.blue },
    red: { face: p.bad, edge: p.badEdge, text: p.onBad, ink: p.bad },
  }[tone];
  const lip = flat ? 0 : 4;
  const textColour = flat || outline ? colours.ink : colours.text;
  return (
    <Pressable
      hitSlop={compact ? 4 : 0}
      {...rest}
      onPress={
        onPress
          ? (e) => {
              tap();
              onPress();
            }
          : undefined
      }
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={rest.accessibilityLabel ?? label}
      accessibilityState={{ ...accessibilityState, disabled: !!disabled }}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderRadius: radius.lg,
          minHeight: compact ? MIN_TOUCH : 52,
          paddingVertical: compact ? 8 : 14,
          paddingHorizontal: compact ? 14 : 18,
          backgroundColor: flat ? "transparent" : outline ? p.surface : colours.face,
          borderWidth: outline ? 2 : 0,
          borderColor: p.border,
          borderBottomWidth: lip + (outline ? 2 : 0) - (pressed ? lip : 0),
          borderBottomColor: outline ? p.border : colours.edge,
          marginTop: pressed ? lip : 0,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {icon ? <MaterialCommunityIcons name={icon as IconName} size={compact ? 16 : 20} color={textColour} /> : null}
      <RNText
        style={{
          color: textColour,
          fontWeight: "800",
          fontSize: compact ? 13 : 15,
          letterSpacing: 0.8,
          textTransform: "uppercase",
        }}
      >
        {label}
      </RNText>
    </Pressable>
  );
}

/** Row of mutually exclusive options. */
export function SegmentedButtons<T extends string>({
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
    <View style={style} className="flex-row gap-2" accessibilityRole="radiogroup">
      {buttons.map((b) => {
        const on = b.value === value;
        return (
          <ChunkyButton
            key={b.value}
            compact
            outline={!on}
            icon={b.icon}
            label={b.label}
            style={{ flex: 1 }}
            onPress={() => onValueChange(b.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
          />
        );
      })}
    </View>
  );
}

function ListIcon({ icon, color }: { icon: string; color?: string }) {
  const p = usePalette();
  return <MaterialCommunityIcons name={icon as IconName} size={22} color={color ?? p.muted} />;
}

function ListItem({
  title,
  description,
  left,
  right,
  titleNumberOfLines = 2,
  ...pressable
}: PressableProps & {
  title: string;
  description?: string;
  left?: (props?: unknown) => ReactNode;
  right?: (props?: unknown) => ReactNode;
  titleNumberOfLines?: number;
}) {
  return (
    <Pressable
      {...pressable}
      accessibilityRole={pressable.onPress ? "button" : undefined}
      className="min-h-11 flex-row items-center gap-3 py-2"
    >
      {left ? <View className="w-6 items-center">{left()}</View> : null}
      <View className="flex-1">
        <RNText className="text-base text-foreground" numberOfLines={titleNumberOfLines}>
          {title}
        </RNText>
        {description ? <RNText className="mt-0.5 text-sm text-muted">{description}</RNText> : null}
      </View>
      {right ? right() : null}
    </Pressable>
  );
}

function ListAccordion({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Accordion selectionMode="single" hideSeparator>
      <Accordion.Item value="a">
        <Accordion.Trigger>
          <RNText className="flex-1 text-sm font-medium text-foreground">{title}</RNText>
          <Accordion.Indicator />
        </Accordion.Trigger>
        <Accordion.Content>{children}</Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );
}

export const List = { Item: ListItem, Icon: ListIcon, Accordion: ListAccordion };

/** Short message at the bottom of the screen; shown whenever `visible` turns true. */
export function Snackbar({
  visible,
  onDismiss,
  duration = 4000,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
  children?: ReactNode;
}) {
  const { toast } = useToast();
  useEffect(() => {
    if (!visible) return;
    toast.show({ label: String(children ?? ""), duration });
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  return null;
}
