import { Avatar, Box, Row, Text, Touchable } from "@financer/ui";

import type { Conversation } from "../../api/types";
import { peopleText } from "../../logic/compose";
import { listTime, type Fmt } from "../../logic/format";

/** One chat as Gmail draws a mail: avatar, the sender with the message count and the time, the subject and a snippet, all in bold while there is something new. */
export function ConversationRow({ c, now, fmt, onPress }: { c: Conversation; now: number; fmt: Fmt; onPress: () => void }) {
  const topic = c.kind === "topic";
  const who = c.people[0];
  const name = topic ? (who ? (who.name ?? who.email) : c.title) : c.title;
  const subject = topic ? peopleText(c.people) : c.topics[0];
  const unread = c.unread > 0;
  return (
    <Touchable onPress={onPress} label={`${c.title}, ${c.unread} unread`} direction="row" align="start" gap="md" py="md" hit={false} testID={`chat-${c.key}`}>
      <Avatar name={name} size="lg" />
      <Box grow gap="2xs">
        <Row justify="between" gap="sm">
          <Row grow gap="xs">
            <Box shrink>
              <Text variant={unread ? "bodyStrong" : "body"} numberOfLines={1}>{c.title}</Text>
            </Box>
            {c.count > 1 ? <Text variant="caption" tone="muted">{String(c.count)}</Text> : null}
          </Row>
          <Text variant="caption" tone={unread ? "default" : "muted"}>{listTime(c.last_at, now, fmt)}</Text>
        </Row>
        {subject ? <Text variant={unread ? "bodyStrong" : "label"} tone={unread ? "default" : "muted"} numberOfLines={1}>{subject}</Text> : null}
        <Text variant="label" tone="muted" numberOfLines={2}>{`${c.last_from_me ? "You: " : ""}${c.preview}`}</Text>
      </Box>
    </Touchable>
  );
}
