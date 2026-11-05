import { Avatar, Badge, Box, Row, Text, Touchable } from "@financer/ui";

import type { Conversation } from "../../api/types";
import { peopleText } from "../../logic/compose";
import { listTime, type Fmt } from "../../logic/format";

/** One line of the chat list: who (or what topic), the last thing said, when, and how much is new. */
export function ConversationRow({ c, now, fmt, onPress }: { c: Conversation; now: number; fmt: Fmt; onPress: () => void }) {
  const topic = c.kind === "topic";
  const who = c.people[0];
  const name = topic ? (who ? (who.name ?? who.email) : c.title) : c.title;
  const sub = topic ? `${peopleText(c.people)} · ${c.count} ${c.count === 1 ? "message" : "messages"}` : c.topics[0];
  const unread = c.unread > 0;
  return (
    <Touchable onPress={onPress} label={`${c.title}, ${c.unread} unread`} direction="row" align="center" gap="md" py="md" hit={false} testID={`chat-${c.key}`}>
      <Avatar name={name} size="lg" />
      <Box grow gap="2xs">
        <Row justify="between" gap="sm">
          <Box grow>
            <Text variant={unread ? "bodyStrong" : "body"} numberOfLines={1}>{c.title}</Text>
          </Box>
          <Text variant="caption" tone={unread ? "accent" : "muted"}>{listTime(c.last_at, now, fmt)}</Text>
        </Row>
        {sub ? <Text variant={unread ? "bodyStrong" : "label"} tone={unread ? "default" : "muted"} numberOfLines={1}>{sub}</Text> : null}
        <Row justify="between" gap="sm">
          <Box grow>
            <Text variant="caption" tone="muted" numberOfLines={2}>{`${c.last_from_me ? "You: " : ""}${c.preview}`}</Text>
          </Box>
          {unread ? <Badge label={String(c.unread)} tone="accent" solid /> : null}
        </Row>
      </Box>
    </Touchable>
  );
}
