import type { ReactNode } from "react";

import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";

export type ChatBubbleProps = {
  /** Said by you: on the right, in the accent colour. */
  mine?: boolean;
  text: string;
  /** "14:05" or "Yesterday": under the text. */
  time?: string;
  /** Who said it, for a chat with several people. */
  sender?: string;
  /** Something under the text inside the bubble. */
  children?: ReactNode;
  /** A small note under the text, e.g. "earlier messages hidden". */
  note?: string;
  /** Not read yet: the time is shown in the strong style. */
  unread?: boolean;
  testID?: string;
};

/**
 * One message of a chat. Yours is on the right in the accent colour, theirs on the left in a soft
 * grey; both stop short of the far edge so a conversation reads as two sides. The words carry the
 * meaning ("You" / the sender is in the accessibility label), not the side or the colour alone.
 */
export function ChatBubble({ mine, text, time, sender, children, note, unread, testID }: ChatBubbleProps) {
  const on = mine ? "on-accent-solid" : "default";
  const label = [mine ? "You" : sender, time, text].filter(Boolean).join(", ");
  return (
    <Row justify={mine ? "end" : "start"} align="start" testID={testID}>
      <Box share="most" bg={mine ? "accent-solid" : "sunken"} radius="2xl" px="md" py="sm" gap="2xs" accessible accessibilityLabel={label}>
        {sender && !mine ? <Text variant="caption" tone="muted">{sender}</Text> : null}
        <Text variant="body" tone={on} selectable>{text}</Text>
        {children}
        {note ? <Text variant="caption" tone={mine ? "on-accent-solid" : "subtle"}>{note}</Text> : null}
        {time ? <Text variant={unread ? "badge" : "caption"} tone={mine ? "on-accent-solid" : unread ? "default" : "muted"} align="right">{time}</Text> : null}
      </Box>
    </Row>
  );
}
