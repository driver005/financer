import { useState } from "react";

import {
  Badge, Banner, Box, Button, Card, EmptyState, Hint, ListItem, MatchBadge, Meter, MeterRow, SavingsBar, ScoreRing, Skeleton, Sparkline, Spinner, Stack, Row, Text, Thumbnail, tones,
  type Tone,
} from "@financer/ui";

import { history } from "../sample";
import type { StoryDef } from "../Story";

function Badges() {
  return (
    <Row gap="sm" wrap>
      {tones.map((t: Tone) => <Badge key={t} label={t} tone={t} />)}
      {tones.map((t: Tone) => <Badge key={`s-${t}`} label={`${t} solid`} tone={t} solid />)}
      <Badge label="With icon" icon="tag-outline" tone="success" />
    </Row>
  );
}

function Banners() {
  return (
    <Stack gap="md">
      <Banner tone="info" title="Nothing is read yet">Press Search to read your shops and build the index.</Banner>
      <Banner tone="success">12 products indexed for “pixel 9”.</Banner>
      <Banner tone="warning" title="Some specs are unknown" action={<Button label="Add them" variant="soft" tone="warning" size="sm" onPress={() => {}} />}>The ranking uses what is known and says so.</Banner>
      <Banner tone="danger">No source could be read. Check the address of the shop.</Banner>
    </Stack>
  );
}

function Progress() {
  const [v] = useState(0.4);
  return (
    <Stack gap="md">
      <Meter value={v} label="Indexing" />
      <Meter value={1} tone="success" thickness="lg" />
      <MeterRow label="Battery" value="5000 mAh" score={0.82} />
      <MeterRow label="Charging speed" value="25 W" score={0.45} />
      <MeterRow label="Performance" value="2.100" score={0.18} />
      <MeterRow label="Camera" value={null} score={null} />
      <Row gap="lg" wrap>
        <ScoreRing score={82} size="sm" />
        <ScoreRing score={64} size="md" />
        <ScoreRing score={31} size="lg" caption="of 100" />
      </Row>
      <Sparkline values={history} tone="success" />
    </Stack>
  );
}

function Cards() {
  return (
    <Stack gap="md">
      <Card variant="raised"><Text variant="bodyStrong">Raised</Text><Text variant="body" tone="muted">Floats above the page with a shadow.</Text></Card>
      <Card variant="outline"><Text variant="bodyStrong">Outline</Text><Text variant="body" tone="muted">A border and nothing else.</Text></Card>
      <Card variant="flat"><Text variant="bodyStrong">Flat</Text><Text variant="body" tone="muted">A quiet fill.</Text></Card>
      <Card tone="accent"><Text variant="bodyStrong" tone="on-accent-soft">Tinted</Text></Card>
      <Card selected onPress={() => {}} label="Selected"><Text variant="bodyStrong">Selected and pressable</Text></Card>
    </Stack>
  );
}

function Lists() {
  return (
    <Card padded={false}>
      <Box px="lg">
        <ListItem title="Categories and criteria" subtitle="Change what is measured" icon="shape-outline" onPress={() => {}} />
        <ListItem title="Server" subtitle="Connected" icon="server" trailing={<Badge label="online" tone="success" />} />
        <ListItem title="Alerts" icon="bell-outline" onPress={() => {}} />
      </Box>
    </Card>
  );
}

function States() {
  return (
    <Stack gap="lg">
      <Stack gap="sm"><Skeleton height="lg" radius="xl" /><Skeleton /><Skeleton width="half" /></Stack>
      <Row gap="lg"><Spinner /><Spinner large /><Text variant="caption" tone="muted">loading</Text></Row>
      <Row gap="md"><Thumbnail dim="thumb-sm" /><Thumbnail dim="thumb-sm" uri="https://invalid.example/none.png" /><Thumbnail dim="avatar-md" radius="full" fallback="account" /></Row>
    </Stack>
  );
}

export const feedback: StoryDef[] = [
  { id: "badges", title: "Badges", note: "Short status labels. The words carry the meaning, the colour supports it.", render: () => <Badges /> },
  { id: "banners", title: "Banners", render: () => <Banners /> },
  {
    id: "hint",
    title: "Hint, match badge and savings",
    note: "A quiet note about what was understood; the match score as a pill; what switching would save against what you pay now.",
    render: () => (
      <Stack gap="md">
        <Hint>Understood 3 conditions · budget 700 €</Hint>
        <Row gap="sm" wrap><MatchBadge score={96} /><MatchBadge score={55} /><MatchBadge score={20} /></Row>
        <SavingsBar title="Switching from Telekom M saves" amount="8,00 € a month" detail="192,00 € over 24 months" share={0.27} caption="27 % of what you pay now, with Example Flat M" />
      </Stack>
    ),
  },
  { id: "meters", title: "Progress, scores and history", note: "A missing value is shown as unknown, not as zero.", render: () => <Progress /> },
  { id: "cards", title: "Cards", render: () => <Cards /> },
  { id: "lists", title: "List items", render: () => <Lists /> },
  { id: "loading", title: "Loading and pictures", render: () => <States /> },
  { id: "empty", title: "Empty state", note: "Say what is missing and why, and offer at most one action.", render: () => <EmptyState title="Nothing matches" message="Try fewer words or a higher price limit." action={<Button label="Clear filters" variant="soft" onPress={() => {}} />} /> },
];
