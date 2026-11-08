import type { ReactNode } from "react";
import { Modal, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "../theme/ThemeProvider";

/**
 * A page that covers the whole window, over whatever is open (the one search of the app). It keeps the
 * safe areas, takes the page background and slides up; closing it is the caller's job (`onClose` is the
 * back button of the device).
 */
export function FullScreenSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent={false}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <View style={{ flex: 1 }}>{children}</View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
