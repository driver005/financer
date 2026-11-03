import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppShell, Box, Row, Screen, Segmented, Stack, Text, ThemeProvider, TopBar, type Device, type NavItem, type SchemeSetting } from "@financer/ui";

import { Story, type StoryDef } from "./Story";
import { actions } from "./stories/actions";
import { feedback } from "./stories/feedback";
import { financeStories } from "./stories/finance";
import { foundations } from "./stories/foundations";
import { layoutStories } from "./stories/layout";
import { mailStories } from "./stories/mail";
import { shopStories } from "./stories/shop";

type Group = "foundations" | "actions" | "feedback" | "layout" | "finance" | "shop" | "mail";

const GROUPS: (NavItem<Group> & { stories: StoryDef[]; title: string })[] = [
  { key: "foundations", label: "Tokens", title: "Foundations", icon: "palette-outline", stories: foundations },
  { key: "actions", label: "Inputs", title: "Actions and inputs", icon: "gesture-tap", stories: actions },
  { key: "feedback", label: "Display", title: "Feedback and data", icon: "view-dashboard-outline", stories: feedback },
  { key: "layout", label: "Layout", title: "Layout and navigation", icon: "page-layout-body", stories: layoutStories },
  { key: "finance", label: "Finance", title: "Finance", icon: "cash-multiple", stories: financeStories },
  { key: "shop", label: "Shopping", title: "Shopping", icon: "shopping-outline", stories: shopStories },
  { key: "mail", label: "Mail", title: "Mail", icon: "email-outline", stories: mailStories },
];

const DEVICES = [
  { value: "window", label: "Window" },
  { value: "phone", label: "Phone" },
  { value: "tablet", label: "Tablet" },
  { value: "desktop", label: "Laptop" },
] as const;

const SCHEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export default function App() {
  const [scheme, setScheme] = useState<SchemeSetting>("system");
  return (
    <SafeAreaProvider>
      <ThemeProvider scheme={scheme}>
        <StatusBar style="auto" />
        <Catalog scheme={scheme} onScheme={setScheme} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Catalog({ scheme, onScheme }: { scheme: SchemeSetting; onScheme: (s: SchemeSetting) => void }) {
  const [group, setGroup] = useState<Group>("foundations");
  const [device, setDevice] = useState<Device | "window">("window");
  const current = GROUPS.find((g) => g.key === group) ?? GROUPS[0];
  return (
    <AppShell items={GROUPS} active={group} onChange={setGroup} title="UI catalog">
      <Screen header={<TopBar title={current.title} subtitle={`${current.stories.length} elements`} />} maxW="full">
        <Stack gap="md">
          <Box direction={{ base: "column", md: "row" }} gap="md" align="stretch">
            <Box grow><Stack gap="xs"><Text variant="caption" tone="muted">Preview as</Text><Segmented value={device} onChange={setDevice} options={DEVICES} testID="device-switch" /></Stack></Box>
            <Box grow><Stack gap="xs"><Text variant="caption" tone="muted">Theme</Text><Segmented value={scheme} onChange={onScheme} options={SCHEMES} testID="theme-switch" /></Stack></Box>
          </Box>
        </Stack>
        {current.stories.map((s) => <Story key={s.id} story={s} device={device} />)}
      </Screen>
    </AppShell>
  );
}
