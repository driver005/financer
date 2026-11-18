import React from "react";
import { Pressable, StyleSheet, Text as RNText, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName, useFinanceTheme } from "./primitives";
import { radius, spacing, typography } from "./tokens";

export type NavItem = { key: string; label: string; icon: IconName };

/** Pockaw-style floating glass bottom bar with a centered primary action. */
export function FloatingBottomNav({ items, active, onChange, onAdd, addLabel = "Add transaction" }: {
  items: NavItem[]; active: string; onChange: (key: string) => void; onAdd: () => void; addLabel?: string;
}) {
  const theme = useFinanceTheme();
  const insets = useSafeAreaInsets();
  const half = Math.ceil(items.length / 2);
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.mdSm) }]} pointerEvents="box-none">
      <View style={[styles.bar, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        {items.slice(0, half).map((item) => <NavButton key={item.key} item={item} active={active === item.key} onPress={() => onChange(item.key)} />)}
        <Pressable accessibilityRole="button" accessibilityLabel={addLabel} onPress={onAdd} style={[styles.fab, { backgroundColor: theme.primary }]}>
          <Icon name="plus" size={26} color={theme.surface} />
        </Pressable>
        {items.slice(half).map((item) => <NavButton key={item.key} item={item} active={active === item.key} onPress={() => onChange(item.key)} />)}
      </View>
    </View>
  );
}

function NavButton({ item, active, onPress }: { item: NavItem; active: boolean; onPress: () => void; key?: React.Key }) {
  const theme = useFinanceTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={item.label} onPress={onPress} style={styles.item}>
      <View style={[styles.iconWrap, active && { backgroundColor: theme.primarySoft }]}>
        <Icon name={item.icon} size={20} color={active ? theme.primary : theme.muted} />
      </View>
      <RNText style={[typography.body5, { fontFamily: typography.font.display, color: active ? theme.primary : theme.muted }]}>{item.label}</RNText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.mdSm },
  bar: { flexDirection: "row", alignItems: "center", borderRadius: radius.full, borderWidth: 1, paddingVertical: spacing.mdSm, minHeight: 64, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 16, elevation: 8 },
  item: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  iconWrap: { width: 38, height: 28, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  fab: { width: 50, height: 50, borderRadius: radius.full, alignItems: "center", justifyContent: "center", marginHorizontal: spacing.mdSm },
});
