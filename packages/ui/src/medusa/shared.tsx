import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";

import type { Tone } from "../constants/colors";
import { space } from "../constants/spacing";
import { Box } from "../primitives/Box";
import type { IconName } from "../primitives/Icon";
import { useTheme } from "../theme/ThemeProvider";

/** Medusa names its tag colours; packages/ui names the role. */
export type MedusaColor = "green" | "red" | "blue" | "orange" | "purple" | "grey";
export const colorTone: Record<MedusaColor, Tone> = { green: "success", red: "danger", blue: "info", orange: "warning", purple: "accent", grey: "neutral" };

/** Medusa's step status (progress tabs and accordions). */
export type StepStatus = "not-started" | "in-progress" | "completed";
export const statusIcon: Record<StepStatus, IconName> = { "not-started": "circle-outline", "in-progress": "progress-clock", completed: "check-circle" };
export const statusTone: Record<StepStatus, "subtle" | "info" | "success"> = { "not-started": "subtle", "in-progress": "info", completed: "success" };

/**
 * What Medusa's Popover, Tooltip, Prompt, DropdownMenu and Command all stand on: a card over a scrim,
 * in the middle of the screen or at the bottom (a menu on a phone), closed by a tap outside.
 */
export function Overlay({ visible, onClose, placement = "center", children }: { visible: boolean; onClose: () => void; placement?: "center" | "bottom"; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: placement === "center" ? "center" : "flex-end", alignItems: "center", backgroundColor: colors.scrim, padding: space.lg }}>
        <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        <Box bg="raised" radius="2xl" shadow="overlay" maxW="narrow" maxH="sheet" overflow="hidden" full>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </Box>
      </View>
    </Modal>
  );
}
