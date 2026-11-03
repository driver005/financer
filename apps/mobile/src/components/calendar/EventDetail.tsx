import { useState } from "react";
import { Badge, Box, Button, Dot, Icon, Row, Sheet, Text, useColors, type IconName } from "@financer/ui";

import { longDay, reminderText, repeatText, timeRange, type Occurrence, type Repeat } from "@/calendar";

function Line({ icon, children }: { icon: IconName; children: string }) {
  return (
    <Row gap="md" align="start">
      <Icon name={icon} tone="muted" />
      <Box grow><Text>{children}</Text></Box>
    </Row>
  );
}

/** One event: when, where, what, and what can be done with it (change it, delete it, open the part of the app it comes from). */
export function EventDetail({ occurrence: o, calendar, repeat, reminders, onClose, onEdit, onDelete, onOpenLink }: { occurrence: Occurrence | null; calendar: string; repeat?: Repeat; reminders?: number[]; onClose: () => void; onEdit: () => void; onDelete: (scope: "this" | "all") => void; onOpenLink: (href: string) => void }) {
  const colors = useColors();
  const [asking, setAsking] = useState(false);
  if (!o) return null;
  const close = () => {
    setAsking(false);
    onClose();
  };
  const when = o.startDate === o.endDate ? longDay(o.startDate) : `${longDay(o.startDate)} to ${longDay(o.endDate)}`;
  return (
    <Sheet
      visible
      onClose={close}
      title={o.title}
      footer={
        o.readOnly ? (
          o.href ? <Button label={`Open in ${o.source ?? "the app"}`} icon="open-in-new" full onPress={() => { const href = o.href!; close(); onOpenLink(href); }} /> : undefined
        ) : asking ? (
          <Box gap="sm">
            <Text variant="bodyStrong">{o.repeats ? "Delete which events?" : "Delete this event?"}</Text>
            {o.repeats ? <Button label="This event" tone="danger" variant="outline" full onPress={() => { close(); onDelete("this"); }} /> : null}
            <Button label={o.repeats ? "All events" : "Delete"} tone="danger" full onPress={() => { close(); onDelete("all"); }} />
            <Button label="Cancel" variant="ghost" full onPress={() => setAsking(false)} />
          </Box>
        ) : (
          <Row gap="sm">
            <Box grow><Button label="Edit" icon="pencil-outline" variant="secondary" full onPress={() => { close(); onEdit(); }} /></Box>
            <Box grow><Button label="Delete" icon="delete-outline" tone="danger" variant="outline" full onPress={() => setAsking(true)} /></Box>
          </Row>
        )
      }
    >
      <Row gap="sm" align="center">
        <Dot color={colors.tones[o.tone].solid} />
        <Text variant="label" tone="muted">{calendar}</Text>
        {o.source ? <Badge label={o.source} tone={o.tone} /> : null}
      </Row>
      <Line icon="clock-outline">{`${when}${o.allDay ? "" : `, ${timeRange(o)}`}`}</Line>
      {o.allDay ? <Line icon="calendar-today">All day</Line> : null}
      {repeat && repeat.kind !== "none" ? <Line icon="repeat">{repeatText(repeat)}</Line> : null}
      {o.location ? <Line icon="map-marker-outline">{o.location}</Line> : null}
      {reminders && reminders.length > 0 ? <Line icon="bell-outline">{reminders.map(reminderText).join(", ")}</Line> : null}
      {o.notes ? <Line icon="text">{o.notes}</Line> : null}
    </Sheet>
  );
}
