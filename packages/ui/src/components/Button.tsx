import type { Tone } from "../constants/colors";
import { Icon, type IconName } from "../primitives/Icon";
import type { BgToken } from "../primitives/boxStyle";
import { Text, type TextTone } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { Spinner } from "./Spinner";

/** HeroUI's names in brackets: solid (primary), secondary (a neutral fill with brand text), tertiary (a neutral fill),
 *  soft (a tinted fill, "danger-soft" for the danger tone), outline, ghost. */
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

export function buttonLook(variant: ButtonVariant, tone: Tone): { bg?: BgToken; text: TextTone; outline?: boolean } {
  switch (variant) {
    case "solid":
      return { bg: `${tone}-solid`, text: `on-${tone}-solid` };
    case "secondary":
      return { bg: "sunken", text: tone === "neutral" ? "default" : tone };
    case "tertiary":
      return { bg: "sunken", text: "default" };
    case "soft":
      return { bg: `${tone}-soft`, text: `on-${tone}-soft` };
    case "outline":
      return { text: tone === "neutral" ? "default" : tone, outline: true };
    case "ghost":
      return { text: tone === "neutral" ? "default" : tone };
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
      border={look.outline ? "hairline" : undefined}
      borderTone={tone === "neutral" ? "strong" : tone}
      radius={s === "lg" ? "4xl" : "3xl"}
      px={s === "sm" ? "md" : s === "md" ? "lg" : "xl"}
      control={s}
      direction="row"
      align="center"
      justify="center"
      gap={s === "sm" ? "xs" : "sm"}
      hit={s === "sm"}
    >
      {loading ? <Spinner tone={look.text} /> : icon ? <Icon name={icon} size="md" tone={look.text} /> : null}
      <Text variant={s === "lg" ? "controlLarge" : s === "md" ? "control" : "label"} tone={look.text} numberOfLines={1}>
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
      border={look.outline ? "hairline" : undefined}
      borderTone={tone === "neutral" ? "strong" : tone}
      radius="full"
      control={s}
      square
      align="center"
      justify="center"
    >
      <Icon name={icon} size={s === "lg" ? "lg" : "md"} tone={look.text} />
    </Touchable>
  );
}
