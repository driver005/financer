import { useState } from "react";

import {
  BarChart, Box, Button, Card, ChoiceCard, ColumnChart, CompareBars, ConfirmAction, CurveChart, DonutChart, Dot, Expandable, Group, HeroCaption, HeroCard, HeroChip, HeroFigure, HeroNumber,
  HeroProgress, HeroStats, IconBadge, ListItem, Mascot, MascotFace, Money, Note, ProgressRing, Row, ScanFrame, Snackbar, Stack, Stepper, Text, TileButton, ToggleRow, useSeriesColor,
  Icon,
} from "@financer/ui";

import type { StoryDef } from "../Story";

const days = [1200, 0, 2400, 1800, 900, 3100, 1500, 2200, 600, 0, 1900, 2800, 1100, 2600];

function Money_() {
  return (
    <Stack gap="sm">
      <Row gap="lg" wrap>
        <Money cents={-2347} variant="bodyStrong" />
        <Money cents={285000} variant="bodyStrong" signed />
        <Money cents={123456} variant="title" tone="plain" />
        <Money cents={-8000} variant="bodyStrong" tone="bad" />
      </Row>
      <Text variant="caption" tone="muted">German notation, a real minus sign, tabular numerals, never wraps. Income is green, spending is the normal ink.</Text>
    </Stack>
  );
}

function Hero() {
  return (
    <Stack gap="lg">
      <HeroCard label="Left to budget per month" chip={<HeroChip icon="check-circle-outline" text="On track" />}>
        <HeroFigure cents={103250} />
        <HeroCaption>From your recurring payments: income minus fixed costs.</HeroCaption>
        <HeroStats items={[{ label: "Income", value: "2.850,00 €" }, { label: "Fixed costs", value: "1.817,50 €" }]} />
      </HeroCard>
      <HeroCard label="Badges earned" chip={<HeroChip icon="trophy-outline" text="3 / 8" />}>
        <HeroNumber value="3" suffix="of 8" />
        <HeroProgress progress={3 / 8} label="3 of 8 badges earned" />
      </HeroCard>
      <HeroCard label="Spent, last 14 days">
        <HeroFigure cents={241500} />
        <BarChart values={days} summary="Spent 2.415,00 € in the last 14 days." onCard />
        <HeroCaption>14 % less than the 14 days before.</HeroCaption>
      </HeroCard>
    </Stack>
  );
}

function Charts() {
  const colour = useSeriesColor();
  const cats = [{ key: "groceries", label: "Groceries", cents: 41000, share: 0.41 }, { key: "housing", label: "Housing", cents: 32000, share: 0.32 }, { key: "dining", label: "Dining", cents: 15000, share: 0.15 }, { key: "other", label: "Other", cents: 12000, share: 0.12 }];
  return (
    <Stack gap="xl">
      <BarChart values={days} summary="Spent over 14 days" showSummary />
      <ColumnChart
        summary="Last 7 days"
        average={1500}
        columns={["M", "T", "W", "T", "F", "S", "S"].map((l, i) => ({ key: `${i}`, label: l, value: days[i] ?? 0, strong: i === 6, note: `${Math.round((days[i] ?? 0) / 100)} €` }))}
      />
      <Row gap="xl" wrap>
        <DonutChart slices={cats.map((c) => ({ key: c.key, share: c.share, other: c.key === "other" }))} centre="1.000 €" caption="Spent" summary="Spending by category" />
        <Box grow gap="sm">
          {cats.map((c, i) => (
            <Row key={c.key} gap="sm"><Dot color={colour(i, c.key === "other")} /><Box grow><Text variant="label">{c.label}</Text></Box><Text variant="number">{`${Math.round(c.share * 100)} %`}</Text></Row>
          ))}
        </Box>
      </Row>
      <CompareBars
        summary="This period against last"
        rows={[
          { key: "g", label: "Groceries", current: 41000, previous: 36000, value: <Money cents={41000} variant="label" tone="plain" /> },
          { key: "h", label: "Housing", current: 32000, previous: 32000, value: <Money cents={32000} variant="label" tone="plain" /> },
        ]}
      />
      <Row gap="lg" wrap>
        <ProgressRing progress={0.62} box="md" stroke="lg" label="62 percent"><Text variant="number">62 %</Text></ProgressRing>
        <ProgressRing progress={0.3} box="lg" stroke="lg" tone="warning" label="30 percent"><Text variant="number">30 %</Text></ProgressRing>
      </Row>
      <Card tone="accent">
        <CurveChart
          summary="Spent so far this period"
          build={(w, h, pad) => {
            const pts = Array.from({ length: 14 }, (_, i) => ({ x: pad + ((w - pad * 2) * i) / 29, y: h - pad - ((h - pad * 2) * (i * 6)) / 100 }));
            const last = pts[pts.length - 1];
            return { solid: pts, dashed: [last, { x: w - pad, y: pad * 3 }], today: last };
          }}
        />
      </Card>
    </Stack>
  );
}

function Rows() {
  const [on, setOn] = useState(true);
  const [qty, setQty] = useState(2);
  return (
    <Stack gap="lg">
      <Group>
        <ListItem icon="server-network" tile title="Server settings" subtitle="Keys, bank providers, receipts" onPress={() => {}} />
        <ListItem icon="tag-multiple-outline" tile title="Price sources" value="3 sources" onPress={() => {}} />
        <ToggleRow icon="fingerprint" title="Lock the app" subtitle="Ask for your fingerprint when the app opens." note="Next: 18.10.2026" value={on} onChange={setOn} />
        <ListItem icon="trash-can-outline" tile tone="danger" title="Forget this server" onPress={() => {}} />
        <Expandable icon="creation-outline" title="Recipe ideas by AI" summary="Claude · key set">
          <Note tone="ok">An API key is configured on the server.</Note>
        </Expandable>
      </Group>
      <Row gap="md" wrap>
        <IconBadge icon="cart-outline" tone="success" />
        <IconBadge text="R" tone="danger" />
        <IconBadge text="L" tone="warning" square />
        <Stepper value={qty} unit="servings" onMinus={() => setQty(Math.max(1, qty - 1))} onPlus={() => setQty(qty + 1)} minusLabel="Fewer" plusLabel="More" />
      </Row>
      <Row gap="sm" align="stretch">
        <TileButton icon="camera-outline" label="Scan" hint="Camera" primary onPress={() => {}} />
        <TileButton icon="image-outline" label="Photo" hint="From gallery" onPress={() => {}} />
        <TileButton icon="file-pdf-box" label="PDF" hint="eBon" onPress={() => {}} />
      </Row>
    </Stack>
  );
}

function Choices() {
  const [pick, setPick] = useState("server");
  return (
    <Stack gap="md">
      <ChoiceCard icon="cellphone-lock" title="Compact: on this phone" body="Everything runs inside the app." selected={pick === "phone"} onPress={() => setPick("phone")} />
      <ChoiceCard icon="server-network" title="My own server" body="A server you run refreshes prices around the clock." note="Needs hosting" selected={pick === "server"} onPress={() => setPick("server")} />
      <Row gap="sm" wrap>
        <Note>A tip under a field.</Note>
        <Note tone="ok">Saved.</Note>
        <Note tone="error">That did not work.</Note>
      </Row>
      <ConfirmAction label="Forget this server" icon="server-remove" question="Forget this server?" consequence="The address and token are removed from this device." confirmLabel="Yes, forget it" onConfirm={() => {}} />
    </Stack>
  );
}

function Friends() {
  const [shown, setShown] = useState(false);
  return (
    <Stack gap="lg">
      <Mascot message="You are 12 € under today's goal. Nice." mood="cheer" />
      <Row gap="lg"><MascotFace mood="happy" /><MascotFace mood="worried" /><MascotFace mood="cheer" big /></Row>
      <ScanFrame hint="Hold the barcode inside the frame"><Icon name="barcode-scan" size="xl" tone="accent" /></ScanFrame>
      <Button label="Show a snackbar" variant="outline" onPress={() => setShown(true)} />
      <Snackbar visible={shown} onDismiss={() => setShown(false)}>Saved</Snackbar>
    </Stack>
  );
}

export const financeStories: StoryDef[] = [
  { id: "money", title: "Money", note: "An amount, set the same way everywhere.", render: () => <Money_ /> },
  { id: "hero", title: "Hero card", note: "One per screen, for the number the screen is about.", render: () => <Hero /> },
  { id: "charts", title: "Charts", note: "Every chart has a sentence that says the same in words.", render: () => <Charts /> },
  { id: "rows", title: "Rows, switches, steppers, tiles", note: "The settings and list vocabulary of the finance app.", render: () => <Rows /> },
  { id: "choices", title: "Choices, notes, confirm", note: "Setup answers and the confirm-first danger action.", render: () => <Choices /> },
  { id: "friends", title: "Mascot, scan frame, snackbar", render: () => <Friends /> },
];
