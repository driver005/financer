import { useState } from "react";

import { AppShell, Box, Button, Card, EmptyState, Grid, ProductCardSkeletonList, Section, Sheet, Split, Stack, Text, TextField, TopBar, IconButton, type NavItem } from "@financer/ui";

import type { StoryDef } from "../Story";

const ITEMS: NavItem<"search" | "deals" | "plans" | "watching" | "more">[] = [
  { key: "search", label: "Search", icon: "magnify" },
  { key: "deals", label: "Deals", icon: "tag-outline", activeIcon: "tag" },
  { key: "plans", label: "Plans", icon: "sim-outline", activeIcon: "sim" },
  { key: "watching", label: "Watching", icon: "bell-outline", activeIcon: "bell", badge: "2" },
  { key: "more", label: "More", icon: "dots-horizontal" },
];

function Shell() {
  const [active, setActive] = useState<(typeof ITEMS)[number]["key"]>("search");
  return (
    <Box h="preview">
      <AppShell items={ITEMS} active={active} onChange={setActive} title="Shopping">
        <TopBar title={ITEMS.find((i) => i.key === active)?.label ?? ""} subtitle="The navigation follows the width" actions={<IconButton icon="cog-outline" label="Settings" />} />
        <Box p="lg"><Text variant="body" tone="muted">Switch the device above: a bottom bar on a phone, a rail on a tablet, a sidebar on a laptop.</Text></Box>
      </AppShell>
    </Box>
  );
}

function GridDemo() {
  return (
    <Grid>
      {Array.from({ length: 8 }, (_, i) => (
        <Card key={i} variant="raised"><Text variant="bodyStrong">Item {i + 1}</Text><Text variant="caption" tone="muted">Columns follow the width.</Text></Card>
      ))}
    </Grid>
  );
}

function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap="md">
      <Button label="Open the sheet" variant="soft" onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Filters" footer={<Button label="Show 12 results" full onPress={() => setOpen(false)} />}>
        <Text variant="body" tone="muted">A bottom sheet on a phone, a centred dialog on a larger screen.</Text>
      </Sheet>
    </Stack>
  );
}

export const layoutStories: StoryDef[] = [
  { id: "shell", title: "App shell", note: "Bottom bar on compact, rail on medium, sidebar on expanded.", render: () => <Shell /> },
  { id: "grid", title: "Grid", render: () => <GridDemo /> },
  { id: "section", title: "Section", render: () => <Section title="Our picks" description="Best overall, best value and more" action={{ label: "See all", onPress: () => {} }}><Text variant="body" tone="muted">The content of the section.</Text></Section> },
  {
    id: "section-card",
    title: "Section in a card",
    note: "A form or a group of settings sits in one white card under its title.",
    render: () => (
      <Section title="Where it runs" card>
        <TextField label="Server address" value="" onChangeText={() => {}} placeholder="https://shop.example.com" />
        <TextField label="Token" value="" onChangeText={() => {}} secure />
        <Button label="Connect" />
      </Section>
    ),
  },
  {
    id: "split",
    title: "Split",
    note: "Side by side on a tablet and a laptop, one under the other on a phone.",
    render: () => (
      <Split>
        <Card><Text variant="bodyStrong">Left</Text><Text variant="body" tone="muted">A picture, a form.</Text></Card>
        <Card><Text variant="bodyStrong">Right</Text><Text variant="body" tone="muted">The price, the result.</Text></Card>
      </Split>
    ),
  },
  { id: "empty-card", title: "Empty state as a card", render: () => <EmptyState card icon="bell-outline" title="No messages yet" message="Watch a search or a product and you are told here when its price drops." action={<Button label="Start watching" variant="soft" icon="bell-plus-outline" />} /> },
  { id: "skeleton-cards", title: "Product cards loading", render: () => <ProductCardSkeletonList count={2} /> },
  { id: "topbar", title: "Top bar", render: () => <TopBar title="Compare" subtitle="3 products" onBack={() => {}} actions={<IconButton icon="share-variant" label="Share" />} /> },
  { id: "sheet", title: "Sheet", render: () => <SheetDemo /> },
];
