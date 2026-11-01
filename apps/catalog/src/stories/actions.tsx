import { useState } from "react";

import {
  Box, Button, Checkbox, Chip, ChipRow, IconButton, OptionList, Row, SearchBar, Segmented, Stack, SwitchRow, Text, TextField, tones,
  type ButtonVariant, type Tone,
} from "@financer/ui";

import type { StoryDef } from "../Story";

const VARIANTS: ButtonVariant[] = ["solid", "secondary", "tertiary", "soft", "outline", "ghost"];

function Buttons() {
  return (
    <Stack gap="lg">
      {VARIANTS.map((v) => (
        <Stack key={v} gap="sm">
          <Text variant="caption" tone="muted">{v}</Text>
          <Row gap="sm" wrap>
            {tones.map((t: Tone) => <Button key={t} label={t} variant={v} tone={t} onPress={() => {}} />)}
          </Row>
        </Stack>
      ))}
      <Row gap="sm" wrap>
        <Button label="Small" size="sm" onPress={() => {}} />
        <Button label="Medium" onPress={() => {}} />
        <Button label="Large" size="lg" onPress={() => {}} />
        <Button label="With icon" icon="magnify" onPress={() => {}} />
        <Button label="Next" iconRight="arrow-right" variant="soft" onPress={() => {}} />
        <Button label="Loading" loading onPress={() => {}} />
        <Button label="Disabled" disabled onPress={() => {}} />
      </Row>
      <Button label="Full width: the main action on a phone" full size="lg" onPress={() => {}} />
      <Row gap="sm">
        <IconButton icon="heart-outline" label="Save" />
        <IconButton icon="share-variant" label="Share" variant="soft" tone="accent" />
        <IconButton icon="filter-variant" label="Filter" variant="outline" />
        <IconButton icon="star" label="Starred" selected />
        <IconButton icon="delete-outline" label="Delete" tone="danger" variant="soft" />
      </Row>
    </Stack>
  );
}

function Chips() {
  const [on, setOn] = useState("phones");
  const [tags, setTags] = useState(["under 600 €", "5G", "Google"]);
  return (
    <Stack gap="md">
      <ChipRow>
        {["phones", "laptops", "plans", "headphones"].map((c) => <Chip key={c} label={c} selected={on === c} onPress={() => setOn(c)} />)}
      </ChipRow>
      <ChipRow>
        {tags.map((t) => <Chip key={t} label={t} onRemove={() => setTags(tags.filter((x) => x !== t))} />)}
        {tags.length === 0 ? <Text variant="caption" tone="muted">All removed. Reload the story to reset.</Text> : null}
      </ChipRow>
      <ChipRow>
        <Chip label="Plain label" />
        <Chip label="With icon" icon="tag-outline" />
        <Chip label="Danger" tone="danger" selected />
      </ChipRow>
    </Stack>
  );
}

function Fields() {
  const [a, setA] = useState("");
  const [b, setB] = useState("5000 mAh");
  const [c, setC] = useState("");
  const [q, setQ] = useState("");
  return (
    <Stack gap="lg">
      <SearchBar value={q} onChangeText={setQ} placeholder="best phone under 600 € with a good camera" />
      <TextField label="Name" value={a} onChangeText={setA} placeholder="Gaming phone" helper="Shown in the category list" />
      <TextField label="With icon and clear button" value={b} onChangeText={setB} icon="battery" clearable />
      <TextField label="With an error" value={c} onChangeText={setC} error="The formula ends with an operator" placeholder="battery_mah /" />
      <TextField label="Several lines" value="" onChangeText={() => {}} multiline placeholder="[ { ... } ]" />
    </Stack>
  );
}

function Choices() {
  const [seg, setSeg] = useState("grid");
  const [sw, setSw] = useState(true);
  const [cb, setCb] = useState(false);
  const [opt, setOpt] = useState("best");
  return (
    <Stack gap="lg">
      <Segmented value={seg} onChange={setSeg} options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }, { value: "table", label: "Table" }]} />
      <SwitchRow label="Tell me about deals" description="Shown when a search finds a watched price." value={sw} onChange={setSw} />
      <Checkbox label="Only in stock" checked={cb} onChange={setCb} />
      <OptionList
        value={opt}
        onChange={setOpt}
        options={[
          { value: "best", label: "Best match", description: "Ranked by your weights" },
          { value: "price", label: "Price: low to high" },
          { value: "new", label: "Newest" },
        ]}
      />
      <Box />
    </Stack>
  );
}

export const actions: StoryDef[] = [
  { id: "buttons", title: "Buttons", note: "Six variants in six tones, three sizes of 48, 56 and 64. A solid button sits on a thick edge and sinks onto it when pressed. One solid primary action per screen.", render: () => <Buttons /> },
  { id: "chips", title: "Chips", note: "Switchable filters, removable applied filters, plain labels.", render: () => <Chips /> },
  { id: "fields", title: "Text fields and search", render: () => <Fields /> },
  { id: "choices", title: "Choices", render: () => <Choices /> },
];
