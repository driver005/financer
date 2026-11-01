import type { ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Badge } from "../components/Badge";
import { Box, Row, Stack } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";
import { Touchable } from "../primitives/Touchable";
import { borderWidth } from "../constants/radius";
import { size } from "../constants/sizes";
import { View } from "react-native";
import { useLayout } from "../responsive/useLayout";
import { useTheme } from "../theme/ThemeProvider";
import { Divider } from "../components/Divider";

export type NavItem<K extends string = string> = { key: K; label: string; icon: IconName; activeIcon?: IconName; badge?: string };

type Props<K extends string> = { items: readonly NavItem<K>[]; active: K; onChange: (key: K) => void };

/** Bottom navigation for phones: icon over label, the active one in a soft pill. */
export function TabBar<K extends string>({ items, active, onChange }: Props<K>) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingBottom: insets.bottom }}>
      <Divider />
      <Row bg="surface" px="sm" py="xs" accessibilityRole="tablist" align="start">
        {items.map((it) => {
          const on = it.key === active;
          return (
            <Box key={it.key} equal>
              <Touchable onPress={() => onChange(it.key)} label={it.label} role="tab" selected={on} align="center" gap="2xs" py="xs" hit={false} control="lg">
                <Box px="lg" py="2xs" radius="full" bg={on ? "accent-soft" : undefined} align="center">
                  <Icon name={on && it.activeIcon ? it.activeIcon : it.icon} size="lg" tone={on ? "on-accent-soft" : "muted"} />
                </Box>
                <Text variant="caption" tone={on ? "default" : "muted"} numberOfLines={1}>{it.label}</Text>
              </Touchable>
            </Box>
          );
        })}
      </Row>
    </View>
  );
}

/** Navigation for tablets: a narrow column on the left, icon over label. */
export function NavRail<K extends string>({ items, active, onChange, header }: Props<K> & { header?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: size.nav.rail, backgroundColor: colors.surface, borderRightWidth: borderWidth.hairline, borderRightColor: colors.border.default }}>
      <Stack gap="sm" py="lg" align="center" accessibilityRole="tablist">
        {header}
        {items.map((it) => {
          const on = it.key === active;
          return (
            <Touchable key={it.key} onPress={() => onChange(it.key)} label={it.label} role="tab" selected={on} align="center" gap="2xs" hit={false}>
              <Box px="lg" py="xs" radius="full" bg={on ? "accent-soft" : undefined} align="center">
                <Icon name={on && it.activeIcon ? it.activeIcon : it.icon} size="lg" tone={on ? "on-accent-soft" : "muted"} />
              </Box>
              <Text variant="caption" tone={on ? "default" : "muted"} numberOfLines={1}>{it.label}</Text>
            </Touchable>
          );
        })}
      </Stack>
    </View>
  );
}

/** Navigation for large screens and the web: a column with the name of the app on top. */
export function Sidebar<K extends string>({ items, active, onChange, title, footer }: Props<K> & { title: string; footer?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ width: size.nav.sidebar, backgroundColor: colors.surface, borderRightWidth: borderWidth.hairline, borderRightColor: colors.border.default }}>
      <Stack gap="xs" p="lg" grow accessibilityRole="tablist">
        <Box px="md" py="md"><Text variant="heading" level={1}>{title}</Text></Box>
        {items.map((it) => {
          const on = it.key === active;
          return (
            <Touchable key={it.key} onPress={() => onChange(it.key)} label={it.label} role="tab" selected={on} direction="row" align="center" gap="md" px="md" py="sm" radius="lg" bg={on ? "accent-soft" : undefined} hit={false} control="md">
              <Icon name={on && it.activeIcon ? it.activeIcon : it.icon} size="md" tone={on ? "on-accent-soft" : "muted"} />
              <Box grow><Text variant="label" tone={on ? "on-accent-soft" : "default"} numberOfLines={1}>{it.label}</Text></Box>
              {it.badge ? <Badge label={it.badge} tone="accent" solid /> : null}
            </Touchable>
          );
        })}
        <Box grow />
        {footer}
      </Stack>
    </View>
  );
}

export type AppShellProps<K extends string> = Props<K> & { title: string; children: ReactNode; railHeader?: ReactNode; sidebarFooter?: ReactNode };

/**
 * The frame of the app. The navigation follows the window: a bottom bar on a phone, a rail on a
 * tablet, a sidebar on a large screen or the web. The content is the same everywhere.
 */
export function AppShell<K extends string>({ items, active, onChange, title, children, railHeader, sidebarFooter }: AppShellProps<K>) {
  const { layout } = useLayout();
  const { colors } = useTheme();
  const nav: Props<K> = { items, active, onChange };
  return (
    <View style={{ flex: 1, flexDirection: layout === "compact" ? "column" : "row", backgroundColor: colors.background }}>
      {layout === "expanded" ? <Sidebar {...nav} title={title} footer={sidebarFooter} /> : null}
      {layout === "medium" ? <NavRail {...nav} header={railHeader} /> : null}
      <View style={{ flex: 1 }}>{children}</View>
      {layout === "compact" ? <TabBar {...nav} /> : null}
    </View>
  );
}
