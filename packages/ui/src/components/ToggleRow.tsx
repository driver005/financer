import type { IconName } from "../primitives/Icon";
import { Box } from "../primitives/Box";
import { ListItem } from "./ListItem";
import { Switch } from "./Switch";

/** A settings row with a switch. The whole row is the tap target; the switch itself is only a picture of the state. */
export function ToggleRow({ icon, title, subtitle, note, value, onChange, disabled }: { icon?: IconName; title: string; subtitle?: string; note?: string; value: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <ListItem
      icon={icon}
      tile
      title={title}
      subtitle={subtitle}
      note={note}
      role="switch"
      checked={value}
      onPress={disabled ? undefined : () => onChange(!value)}
      trailing={
        <Box pointerEvents="none" accessibilityRole="none">
          <Switch value={value} onChange={() => {}} label={title} disabled={disabled} />
        </Box>
      }
    />
  );
}
