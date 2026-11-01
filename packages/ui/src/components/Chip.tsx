import type { Tone } from "../constants/colors";
import { Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";

export type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Shows an x and calls this (applied filters). */
  onRemove?: () => void;
  icon?: IconName;
  tone?: Tone;
  testID?: string;
};

/** A pill: a filter you can switch, an applied filter you can remove, or a plain label. */
export function Chip({ label, selected, onPress, onRemove, icon, tone = "accent", testID }: ChipProps) {
  const active = selected || Boolean(onRemove);
  const content = (
    <>
      {icon ? <Icon name={icon} size="sm" tone={active ? `on-${tone}-soft` : "muted"} /> : null}
      <Text variant="label" tone={active ? `on-${tone}-soft` : "default"} numberOfLines={1}>
        {label}
      </Text>
      {onRemove ? <Icon name="close" size="sm" tone={`on-${tone}-soft`} /> : null}
    </>
  );
  const look = {
    bg: active ? (`${tone}-soft` as const) : ("surface" as const),
    border: "hairline" as const,
    borderTone: active ? tone : ("default" as const),
    radius: "full" as const,
    px: "md" as const,
    control: "sm" as const,
    direction: "row" as const,
    align: "center" as const,
    gap: "xs" as const,
  };
  if (!onPress && !onRemove) return <Row {...look}>{content}</Row>;
  return (
    <Touchable {...look} onPress={onRemove ?? onPress} label={onRemove ? `Remove ${label}` : label} selected={selected} role={onRemove ? "button" : "checkbox"} testID={testID}>
      {content}
    </Touchable>
  );
}

/** Chips that wrap onto more lines. */
export function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <Row wrap gap="sm">
      {children}
    </Row>
  );
}
