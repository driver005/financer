import { useState } from "react";

import { Badge, Button, Row, Text, Stack } from "@financer/ui";

import type { CalendarEvent } from "../../api/types";
import { sourceNote, timeText } from "../../logic/agenda";
import { dayLabel, dayKey, type Fmt } from "../../logic/format";
import { useMail } from "../runtime";

/** Under a bubble: the appointment found in that message, now on the calendar, with a way to take it off. */
export function EventNote({ event, fmt }: { event: CalendarEvent; fmt: Fmt }) {
  const { client, bump, now } = useMail();
  const [removed, setRemoved] = useState(false);
  const today = dayKey(now(), fmt);
  if (removed) return <Text variant="caption" tone="on-neutral-soft">Taken off the calendar</Text>;
  const when = `${dayLabel(event.start.slice(0, 10), today, fmt)}, ${timeText(event, today, fmt)}`;
  return (
    <Stack gap="xs">
      <Badge label={`${event.cancelled ? "Cancelled" : "On your calendar"}: ${when}`} tone={event.cancelled ? "danger" : "success"} icon={event.cancelled ? "calendar-remove" : "calendar-check"} lines={2} />
      <Row gap="sm" wrap>
        <Text variant="caption" tone="subtle">{sourceNote(event.source)}</Text>
        <Button
          label="Remove"
          variant="ghost"
          tone="danger"
          size="sm"
          onPress={async () => {
            await client?.removeEvent(event.id).catch(() => undefined);
            setRemoved(true);
            bump();
          }}
        />
      </Row>
    </Stack>
  );
}
