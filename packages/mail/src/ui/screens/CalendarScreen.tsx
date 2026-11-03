import { useCallback, useEffect, useState } from "react";

import { Badge, Banner, Box, Button, Card, DateBadge, EmptyState, IconButton, Row, Screen, Segmented, Sheet, Skeleton, Stack, Switch, Text, TextField, TopBar } from "@financer/ui";

import { MailApiError } from "../../api/client";
import type { CalendarEvent } from "../../api/types";
import { agendaDays, parseClock, parseDay, RANGES, rangeEnd, sourceNote, timeText, type RangeValue } from "../../logic/agenda";
import { dayKey } from "../../logic/format";
import { useNav } from "../nav";
import { useMail } from "../runtime";

/** What is coming up, found in invitations and in what people wrote. */
export function CalendarScreen() {
  const { client, fmt, now, version, bump } = useMail();
  const nav = useNav();
  const today = dayKey(now(), fmt);
  const [range, setRange] = useState<RangeValue>("31");
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const r = await client.events({ from: today, to: rangeEnd(today, range) });
      setEvents(r.events);
      setError(null);
    } catch (e) {
      setError(e instanceof MailApiError ? e.message : "Could not load the calendar.");
    }
  }, [client, today, range]);
  useEffect(() => void load(), [load, version]);

  const days = events ? agendaDays(events, { from: today, today, fmt }) : [];

  return (
    <Screen
      maxW="normal"
      header={<TopBar title="Calendar" subtitle="Added from your mail" onBack={nav.exit} actions={<IconButton icon="calendar-plus" label="Add an event" variant="soft" tone="accent" onPress={() => setAdding(true)} />} />}
    >
      {error ? <Banner tone="danger" action={<Button label="Try again" variant="outline" tone="neutral" size="sm" onPress={() => void load()} />}>{error}</Banner> : null}
      <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
      {events === null ? (
        <Stack gap="md"><Skeleton /><Skeleton /></Stack>
      ) : days.length === 0 ? (
        <EmptyState
          icon="calendar-blank-outline"
          title="Nothing coming up"
          message={'Invitations are added as they arrive. So are appointments in a sentence, like "Friday at 3 pm" or "12.11. um 14 Uhr".'}
          action={<Button label="Add an event" icon="calendar-plus" onPress={() => setAdding(true)} />}
        />
      ) : (
        <Stack gap="lg">
          {days.map((d) => (
            <Row key={d.key} align="start" gap="md">
              <DateBadge weekday={d.weekday} day={d.day} today={d.today} />
              <Box grow gap="sm">
                <Text variant="label" tone="muted">{d.label}</Text>
                {d.events.map((e) => (
                  <EventCard key={e.id} event={e} today={today} onRemoved={() => { bump(); void load(); }} />
                ))}
              </Box>
            </Row>
          ))}
        </Stack>
      )}
      <AddEvent visible={adding} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); bump(); }} today={today} />
    </Screen>
  );
}

function EventCard({ event, today, onRemoved }: { event: CalendarEvent; today: string; onRemoved: () => void }) {
  const { client, fmt } = useMail();
  return (
    <Card variant="flat" gap="xs">
      <Row justify="between" gap="sm" align="start">
        <Box grow>
          <Text variant="bodyStrong">{event.title}</Text>
        </Box>
        {event.source === "text" ? <Badge label="Check" tone="warning" icon="alert-circle-outline" /> : null}
      </Row>
      <Text variant="label" tone="muted">{timeText(event, today, fmt)}</Text>
      {event.location ? <Text variant="caption" tone="muted">{event.location}</Text> : null}
      {event.recurrence ? <Text variant="caption" tone="subtle">Repeats; only the first date is listed.</Text> : null}
      {event.note ? <Text variant="caption" tone="subtle">{event.note}</Text> : null}
      <Row justify="between" gap="sm">
        <Text variant="caption" tone="subtle">{sourceNote(event.source)}</Text>
        <Button label="Remove" variant="ghost" tone="danger" size="sm" onPress={async () => { await client?.removeEvent(event.id).catch(() => undefined); onRemoved(); }} />
      </Row>
    </Card>
  );
}

function AddEvent({ visible, onClose, onAdded, today }: { visible: boolean; onClose: () => void; onAdded: () => void; today: string }) {
  const { client } = useMail();
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [place, setPlace] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const d = parseDay(day, today);
    const start = parseClock(from);
    const end = to.trim() ? parseClock(to) : null;
    if (!title.trim()) return setError("Give the event a title.");
    if (!d) return setError("Write the day as 2026-11-12 or 12.11.2026.");
    if (!allDay && !start) return setError("Write the start time like 14:30.");
    if (!allDay && to.trim() && !end) return setError("Write the end time like 15:30, or leave it empty.");
    try {
      await client?.createEvent({
        title: title.trim(),
        start: allDay ? d : `${d}T${start}`,
        end: allDay || !end ? null : `${d}T${end}`,
        all_day: allDay,
        location: place.trim() || null,
      });
      setTitle(""); setDay(""); setFrom(""); setTo(""); setPlace(""); setError(null);
      onAdded();
    } catch (e) {
      setError(e instanceof MailApiError ? e.message : "Could not save the event.");
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="New event" footer={<Button label="Add to calendar" full icon="calendar-check" onPress={() => void save()} />}>
      <Stack gap="md">
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <TextField label="Title" value={title} onChangeText={setTitle} placeholder="Dentist" capitalize />
        <TextField label="Day" value={day} onChangeText={setDay} placeholder="12.11.2026" />
        <Row gap="sm" align="center" justify="between"><Text variant="body">All day</Text><Switch value={allDay} onChange={setAllDay} label="All day" /></Row>
        {allDay ? null : (
          <Row gap="md">
            <Box equal><TextField label="From" value={from} onChangeText={setFrom} placeholder="14:30" /></Box>
            <Box equal><TextField label="Until" value={to} onChangeText={setTo} placeholder="15:30" /></Box>
          </Row>
        )}
        <TextField label="Where" value={place} onChangeText={setPlace} placeholder="Optional" capitalize />
      </Stack>
    </Sheet>
  );
}
