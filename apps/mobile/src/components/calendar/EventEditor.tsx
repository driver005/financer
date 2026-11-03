import { useState } from "react";
import { Badge, Banner, Box, Button, Card, Chip, ChipRow, Group, ListItem, Row, Sheet, Stepper, SwitchRow, Text, TextField, TimePicker } from "@financer/ui";

import type { Calendar } from "@/api/client";
import { WEEKDAY_CODES, WEEKDAY_SHORT, longDay, repeatText, reminderText, type RepeatKind } from "@/calendar";
import { REMINDER_CHOICES, moveStart, problem, setRepeatKind, toggleReminder, toggleWeekday, type Draft } from "@/calendarForm";
import { toTone } from "@/calendarTones";
import { DatePanel } from "./DatePanel";

type Panel = "form" | "startDate" | "startTime" | "endDate" | "endTime" | "repeat" | "until";

const KINDS: { value: RepeatKind; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const TITLES: Record<Panel, string> = {
  form: "",
  startDate: "Start date",
  startTime: "Start time",
  endDate: "End date",
  endTime: "End time",
  repeat: "Repeat",
  until: "Repeat until",
};

/**
 * Adds or changes an event in one sheet. The date, time and repeat choices replace the form inside
 * the same sheet (a sheet over a sheet does not work on every platform) and return to it.
 */
export function EventEditor({ draft, calendars, saving, error, onChange, onSave, onClose }: { draft: Draft | null; calendars: Calendar[]; saving: boolean; error: string | null; onChange: (d: Draft) => void; onSave: () => void; onClose: () => void }) {
  const [panel, setPanel] = useState<Panel>("form");
  const [touched, setTouched] = useState(false);
  if (!draft) return null;
  const close = () => {
    setPanel("form");
    setTouched(false);
    onClose();
  };
  const issue = touched ? problem(draft) : null;
  const back = () => setPanel("form");

  let body;
  if (panel === "startDate" || panel === "endDate") {
    const start = panel === "startDate";
    body = (
      <DatePanel
        value={start ? draft.startDate : draft.endDate}
        onPick={(date) => {
          onChange(start ? moveStart(draft, date) : { ...draft, endDate: date });
          back();
        }}
      />
    );
  } else if (panel === "startTime" || panel === "endTime") {
    const start = panel === "startTime";
    body = (
      <>
        <TimePicker value={start ? draft.startTime : draft.endTime} onChange={(t) => onChange(start ? moveStart(draft, draft.startDate, t) : { ...draft, endTime: t })} />
        <Button label="Done" onPress={back} full />
      </>
    );
  } else if (panel === "until") {
    body = <DatePanel value={draft.repeat.until ?? draft.startDate} onPick={(date) => { onChange({ ...draft, repeat: { ...draft.repeat, until: date, count: null } }); setPanel("repeat"); }} />;
  } else if (panel === "repeat") {
    const r = draft.repeat;
    const unit = { none: "", daily: "day", weekly: "week", monthly: "month", yearly: "year" }[r.kind];
    const ends = r.count != null ? "count" : r.until ? "until" : "never";
    body = (
      <>
        <ChipRow>
          {KINDS.map((k) => (
            <Chip key={k.value} label={k.label} selected={r.kind === k.value} onPress={() => onChange(setRepeatKind(draft, k.value))} />
          ))}
        </ChipRow>
        {r.kind !== "none" ? (
          <>
            <Row justify="between" align="center">
              <Text variant="body">{`Every ${r.interval > 1 ? r.interval : ""} ${unit}${r.interval > 1 ? "s" : ""}`.replace("  ", " ")}</Text>
              <Stepper value={r.interval} minusLabel="Fewer" plusLabel="More" onMinus={() => onChange({ ...draft, repeat: { ...r, interval: Math.max(1, r.interval - 1) } })} onPlus={() => onChange({ ...draft, repeat: { ...r, interval: Math.min(99, r.interval + 1) } })} />
            </Row>
            {r.kind === "weekly" ? (
              <ChipRow>
                {WEEKDAY_CODES.map((c, i) => (
                  <Chip key={c} label={WEEKDAY_SHORT[i]} selected={r.weekdays.includes(c)} onPress={() => onChange(toggleWeekday(draft, c))} />
                ))}
              </ChipRow>
            ) : null}
            <Text variant="label" tone="muted">Ends</Text>
            <ChipRow>
              <Chip label="Never" selected={ends === "never"} onPress={() => onChange({ ...draft, repeat: { ...r, until: null, count: null } })} />
              <Chip label={r.until ? `On ${longDay(r.until, draft.startDate)}` : "On a date"} selected={ends === "until"} onPress={() => setPanel("until")} />
              <Chip label="After some times" selected={ends === "count"} onPress={() => onChange({ ...draft, repeat: { ...r, until: null, count: r.count ?? 10 } })} />
            </ChipRow>
            {ends === "count" ? (
              <Row justify="between" align="center">
                <Text variant="body">Occurrences</Text>
                <Stepper value={r.count ?? 1} unit="times" minusLabel="Fewer" plusLabel="More" onMinus={() => onChange({ ...draft, repeat: { ...r, count: Math.max(1, (r.count ?? 1) - 1) } })} onPlus={() => onChange({ ...draft, repeat: { ...r, count: Math.min(999, (r.count ?? 1) + 1) } })} />
              </Row>
            ) : null}
          </>
        ) : null}
        <Button label="Done" onPress={back} full />
      </>
    );
  } else {
    body = (
      <>
        <TextField label="Title" value={draft.title} onChangeText={(title) => onChange({ ...draft, title })} placeholder="Add a title" autoFocus={draft.id === null} capitalize returnKeyType="done" error={issue === "Give the event a title." ? issue : undefined} />
        <Group>
          <Box py="xs"><SwitchRow label="All day" value={draft.allDay} onChange={(allDay) => onChange({ ...draft, allDay })} /></Box>
          <ListItem title="Starts" icon="calendar-outline" value={longDay(draft.startDate)} onPress={() => setPanel("startDate")} chevron />
          {draft.allDay ? null : <ListItem title="Start time" icon="clock-outline" trailing={<Badge label={draft.startTime} tone="accent" />} onPress={() => setPanel("startTime")} chevron />}
          <ListItem title="Ends" icon="calendar-check-outline" value={longDay(draft.endDate)} onPress={() => setPanel("endDate")} chevron />
          {draft.allDay ? null : <ListItem title="End time" icon="clock-check-outline" trailing={<Badge label={draft.endTime} tone="accent" />} onPress={() => setPanel("endTime")} chevron />}
          <ListItem title="Repeat" icon="repeat" value={repeatText(draft.repeat)} onPress={() => setPanel("repeat")} chevron />
        </Group>
        {draft.id !== null && draft.repeat.kind !== "none" ? <Text variant="caption" tone="muted">Changes apply to every event of the series.</Text> : null}
        <Text variant="label" tone="muted">Calendar</Text>
        <ChipRow>
          {calendars.map((c) => (
            <Chip key={c.id} label={c.name} tone={toTone(c.tone)} selected={draft.calendarId === c.id} onPress={() => onChange({ ...draft, calendarId: c.id })} />
          ))}
        </ChipRow>
        <Text variant="label" tone="muted">Reminders</Text>
        <ChipRow>
          {REMINDER_CHOICES.map((m) => (
            <Chip key={m} label={reminderText(m)} selected={draft.reminders.includes(m)} onPress={() => onChange(toggleReminder(draft, m))} />
          ))}
        </ChipRow>
        <Card gap="sm">
          <TextField variant="secondary" value={draft.location} onChangeText={(location) => onChange({ ...draft, location })} placeholder="Add location" icon="map-marker-outline" />
          <TextField variant="secondary" value={draft.notes} onChangeText={(notes) => onChange({ ...draft, notes })} placeholder="Add notes or description" icon="text" multiline />
        </Card>
        {issue && issue !== "Give the event a title." ? <Banner tone="warning">{issue}</Banner> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </>
    );
  }

  return (
    <Sheet
      visible
      onClose={panel === "form" ? close : back}
      title={panel === "form" ? (draft.id === null ? "New event" : "Edit event") : TITLES[panel]}
      footer={
        panel === "form" ? (
          <Button
            label="Save"
            icon="check"
            loading={saving}
            full
            onPress={() => {
              setTouched(true);
              if (problem(draft) === null) onSave();
            }}
          />
        ) : undefined
      }
    >
      {body}
    </Sheet>
  );
}
