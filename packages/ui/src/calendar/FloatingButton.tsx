import { View } from "react-native";

import { space } from "../constants/spacing";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { useLayout } from "../responsive/useLayout";

/**
 * The rounded-square add button floating over the bottom right corner of the nearest positioned parent (the
 * page). On a wide screen it carries its label too, like the "Create" button of Google Calendar.
 */
export function FloatingButton({ icon = "plus", label, onPress, extended, soft }: { icon?: IconName; label: string; onPress: () => void; /** Show the label on a phone too (the Compose button of a mail app). */ extended?: boolean; /** The soft accent fill with dark ink, as Gmail's Compose button, instead of the solid accent. */ soft?: boolean }) {
  const { layout } = useLayout();
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: space.lg, bottom: space.lg }}>
      <Touchable onPress={onPress} label={label} bg={soft ? "accent-soft" : "accent-solid"} radius="2xl" shadow="overlay" control="lg" px="lg" direction="row" align="center" justify="center" gap="sm">
        <Icon name={icon} size="lg" tone={soft ? "on-accent-soft" : "on-accent-solid"} />
        {layout === "compact" && !extended ? null : <Text variant="bodyStrong" tone={soft ? "on-accent-soft" : "on-accent-solid"}>{label}</Text>}
      </Touchable>
    </View>
  );
}
