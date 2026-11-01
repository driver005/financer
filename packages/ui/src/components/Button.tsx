import type { Tone } from "../constants/colors";
import { Icon, type IconName } from "../primitives/Icon";
import type { BgToken, BoxProps } from "../primitives/box";
import { Text, type TextTone } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { Spinner } from "./Spinner";

/** solid: a bright face on a thick edge (the primary action). soft: a tinted face with a line. outline, secondary and
 *  tertiary: a white face with a grey line and edge (the text is the tone, the accent, or plain). ghost: just the text. */
export type ButtonVariant = "solid" | "secondary" | "tertiary" | "soft" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  tone?: Tone;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Fill the width of the parent (primary actions on a phone). */
  full?: boolean;
  testID?: string;
};

type Look = { bg?: BgToken; text: TextTone; border?: boolean; borderTone?: BoxProps["borderTone"]; edge?: BoxProps["edge"] };

export function buttonLook(variant: ButtonVariant, tone: Tone): Look {
  const plain: TextTone = tone === "neutral" ? "default" : `${tone}`;
  switch (variant) {
    case "solid":
      return { bg: `${tone}-solid`, text: `on-${tone}-solid`, edge: tone };
    case "soft":
      return { bg: `${tone}-soft`, text: `on-${tone}-soft`, border: true, borderTone: tone, edge: `${tone}-line` };
    case "outline":
      return { bg: "surface", text: plain, border: true, borderTone: "default", edge: "border" };
    case "secondary":
      return { bg: "surface", text: tone === "neutral" ? "accent" : plain, border: true, borderTone: "default", edge: "border" };
    case "tertiary":
      return { bg: "surface", text: "default", border: true, borderTone: "default", edge: "border" };
    case "ghost":
      return { text: plain };
  }
}

export function Button({ label, onPress, variant = "solid", tone = "accent", size: s = "md", icon, iconRight, loading, disabled, full, testID }: ButtonProps) {
  const look = buttonLook(variant, tone);
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      busy={loading}
      label={label}
      testID={testID}
      full={full}
      bg={look.bg}
      border={look.border ? "thick" : undefined}
      borderTone={look.borderTone}
      edge={look.edge}
      radius="2xl"
      px={s === "sm" ? "lg" : "xl"}
      control={s}
      direction="row"
      align="center"
      justify="center"
      gap="sm"
      hit={s === "sm"}
    >
      {loading ? <Spinner tone={look.text} /> : icon ? <Icon name={icon} size="md" tone={look.text} /> : null}
      <Text variant={s === "lg" ? "controlLarge" : s === "md" ? "control" : "controlSmall"} tone={look.text} numberOfLines={1}>
        {label}
      </Text>
      {iconRight ? <Icon name={iconRight} size="md" tone={look.text} /> : null}
    </Touchable>
  );
}

export type IconButtonProps = {
  icon: IconName;
  /** What it does, for screen readers (there is no visible text). */
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  tone?: Tone;
  size?: ButtonSize;
  disabled?: boolean;
  selected?: boolean;
  testID?: string;
};

/** A square icon-only button with a full-size touch target. */
export function IconButton({ icon, label, onPress, variant = "ghost", tone = "neutral", size: s = "md", disabled, selected, testID }: IconButtonProps) {
  const look = buttonLook(selected ? "soft" : variant, selected ? "accent" : tone);
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      label={label}
      selected={selected}
      testID={testID}
      bg={look.bg}
      border={look.border ? "thick" : undefined}
      borderTone={look.borderTone}
      edge={look.edge}
      edgeSize="sm"
      radius="2xl"
      control={s}
      square
      align="center"
      justify="center"
    >
      <Icon name={icon} size={s === "lg" ? "lg" : "md"} tone={look.text} />
    </Touchable>
  );
}
