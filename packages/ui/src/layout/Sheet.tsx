import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";

import { layoutClassFor } from "../constants/breakpoints";
import { IconButton } from "../components/Button";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { useViewportWidth } from "../responsive/Viewport";
import { useTheme } from "../theme/ThemeProvider";

export type SheetProps = { visible: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode };

/** Filters, menus and details over the page: a bottom sheet on a phone, a centred dialog on larger screens. */
export function Sheet({ visible, onClose, title, children, footer }: SheetProps) {
  const { colors } = useTheme();
  const width = useViewportWidth();
  const compact = layoutClassFor(width) === "compact";
  return (
    <Modal visible={visible} transparent animationType={compact ? "slide" : "fade"} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: compact ? "flex-end" : "center", backgroundColor: colors.scrim }}>
        <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
        <Box bg="raised" radius="3xl" shadow="xl" maxW="narrow" maxH="sheet" overflow="hidden">
          <Row justify="between" gap="md" px="xl" pt="xl" pb="md">
            <Box grow>{title ? <Text variant="heading" level={2}>{title}</Text> : null}</Box>
            <IconButton icon="close" label="Close" onPress={onClose} />
          </Row>
          <ScrollView>
            <Box gap="lg" px="xl" pb="xl">{children}</Box>
          </ScrollView>
          {footer ? <Box px="xl" py="lg" bg="raised">{footer}</Box> : null}
        </Box>
      </View>
    </Modal>
  );
}
