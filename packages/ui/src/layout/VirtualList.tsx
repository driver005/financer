import type { ReactNode } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { size } from "../constants/sizes";
import { space } from "../constants/spacing";
import { useTheme } from "../theme/ThemeProvider";
import { useLayout } from "../responsive/useLayout";

/**
 * A long list that draws only what is on screen, in the same readable column and gutters as a `Screen`.
 * Use it as the only child of a page with a pinned header (`Page fixed`).
 */
export function VirtualList<T>({
  data, renderItem, keyExtractor, header, empty, footer, refreshing, onRefresh, gap = "sm",
}: {
  data: readonly T[];
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string;
  header?: ReactNode;
  empty?: ReactNode;
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  gap?: keyof typeof space;
}) {
  const { colors } = useTheme();
  const { layout } = useLayout();
  const gutter = layout === "compact" ? space.lg : layout === "medium" ? space.xl : space["2xl"];
  return (
    <FlatList
      data={data as T[]}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => <View style={{ paddingBottom: space[gap] }}>{renderItem(item, index)}</View>}
      ListHeaderComponent={header ? <View style={{ paddingBottom: space.lg }}>{header}</View> : null}
      ListEmptyComponent={empty ? <View>{empty}</View> : null}
      ListFooterComponent={footer ? <View style={{ paddingTop: space.md }}>{footer}</View> : null}
      refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={colors.text.muted} /> : undefined}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingVertical: space.lg, width: "100%", maxWidth: size.content.wide, alignSelf: "center" }}
      style={{ flex: 1 }}
    />
  );
}
