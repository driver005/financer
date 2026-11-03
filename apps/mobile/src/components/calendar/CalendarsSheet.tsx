import { useState } from "react";
import { Banner, Box, Button, Chip, ChipRow, Dot, Group, ListItem, Section, Sheet, Switch, Text, TextField, useColors } from "@financer/ui";

import type { Calendar } from "@/api/client";
import type { Tone } from "@/calendar";
import { TONES, TONE_LABEL, toTone } from "@/calendarTones";

/** A calendar that comes from another part of the app: it can be shown or hidden, not changed. */
export type FeedCalendar = { key: string; name: string; description: string; tone: Tone; visible: boolean };

type Editing = { id: number | null; name: string; tone: Tone; visible: boolean };

/** The list of calendars (show or hide each), the feeds from the rest of the app, and making or changing one. */
export function CalendarsSheet({ visible, calendars, feeds, error, onClose, onToggle, onToggleFeed, onSave, onDelete }: { visible: boolean; calendars: Calendar[]; feeds: FeedCalendar[]; error: string | null; onClose: () => void; onToggle: (c: Calendar) => void; onToggleFeed: (key: string) => void; onSave: (id: number | null, value: { name: string; tone: Tone; visible: boolean }) => void; onDelete: (c: Calendar) => void }) {
  const colors = useColors();
  const [editing, setEditing] = useState<Editing | null>(null);
  const done = () => setEditing(null);
  const target = editing?.id == null ? null : calendars.find((c) => c.id === editing.id) ?? null;
  return (
    <Sheet visible={visible} onClose={editing ? done : onClose} title={editing ? (editing.id === null ? "New calendar" : "Calendar") : "Calendars"}>
      {editing ? (
        <>
          <TextField label="Name" value={editing.name} onChangeText={(name) => setEditing({ ...editing, name })} autoFocus capitalize maxLength={60} />
          <ChipRow>
            {TONES.map((t) => (
              <Chip key={t} label={TONE_LABEL[t]} tone={t} selected={editing.tone === t} onPress={() => setEditing({ ...editing, tone: t })} />
            ))}
          </ChipRow>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Button label="Save" icon="check" full disabled={!editing.name.trim()} onPress={() => { onSave(editing.id, { name: editing.name.trim(), tone: editing.tone, visible: editing.visible }); done(); }} />
          {target && calendars.length > 1 ? <Button label="Delete calendar and its events" icon="delete-outline" tone="danger" variant="outline" full onPress={() => { onDelete(target); done(); }} /> : null}
        </>
      ) : (
        <>
          <Group>
            {calendars.map((c) => (
              <ListItem
                key={c.id}
                title={c.name}
                leading={<Dot color={colors.tones[toTone(c.tone)].solid} />}
                trailing={<Switch value={c.visible} onChange={() => onToggle(c)} label={`Show ${c.name}`} />}
                onPress={() => setEditing({ id: c.id, name: c.name, tone: toTone(c.tone), visible: c.visible })}
                label={`Change ${c.name}`}
              />
            ))}
          </Group>
          <Button label="New calendar" icon="plus" variant="secondary" full onPress={() => setEditing({ id: null, name: "", tone: "accent", visible: true })} />
          {feeds.length > 0 ? (
            <Section title="From the rest of the app" quiet>
              <Box gap="xs">
                <Text variant="caption" tone="muted">These fill themselves from your money, meals and shopping. Show or hide them here.</Text>
              </Box>
              <Group>
                {feeds.map((f) => (
                  <ListItem key={f.key} title={f.name} subtitle={f.description} leading={<Dot color={colors.tones[f.tone].solid} />} trailing={<Switch value={f.visible} onChange={() => onToggleFeed(f.key)} label={`Show ${f.name}`} />} />
                ))}
              </Group>
            </Section>
          ) : null}
        </>
      )}
    </Sheet>
  );
}
