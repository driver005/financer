import { View } from "react-native";

import { space } from "../constants/spacing";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { useLayout } from "../responsive/useLayout";

/**
 * The round add button floating over the bottom right corner of the nearest positioned parent (the
 * page). On a wide screen it carries its label too, like the "Create" button of Google Calendar.
 */
export function FloatingButton({ icon = "plus", label, onPress }: { icon?: IconName; label: string; onPress: () => void }) {
  const { layout } = useLayout();
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: space.lg, bottom: space.lg }}>
      <Touchable onPress={onPress} label={label} bg="accent-solid" radius="full" shadow="overlay" control="lg" px="lg" direction="row" align="center" justify="center" gap="sm">
        <Icon name={icon} size="lg" tone="on-accent-solid" />
        {layout === "compact" ? null : <Text variant="bodyStrong" tone="on-accent-solid">{label}</Text>}
      </Touchable>
    </View>
  );
}
