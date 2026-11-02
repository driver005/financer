import type { ReactNode } from "react";

import { Badge } from "../components/Badge";
import { Card } from "../components/Card";
import { Button } from "../components/Button";
import type { Tone } from "../constants/colors";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";

/** A titled block of a page, with an optional link-style action on the right. */
export function Section({
  title, description, tag, aside, action, card, children,
}: {
  title?: string;
  description?: string;
  /** A small badge next to the title ("Top deals", "3 live deals"). */
  tag?: { label: string; tone?: Tone };
  /** A quiet note on the right of the title ("2 recommendations"). */
  aside?: string;
  action?: { label: string; onPress: () => void };
  /** Put the content in one white card (a form, a group of settings). */
  card?: boolean;
  children: ReactNode;
}) {
  return (
    <Box gap="md">
      {title || action ? (
        <Row justify="between" gap="md">
          <Box grow gap="2xs">
            {title ? (
              <Row gap="sm" align="center" wrap>
                <Text variant="heading" level={2}>{title}</Text>
                {tag ? <Badge label={tag.label} tone={tag.tone ?? "success"} /> : null}
              </Row>
            ) : null}
            {description ? <Text variant="body" tone="muted">{description}</Text> : null}
          </Box>
          {aside ? <Box shrink={false}><Text variant="caption" tone="muted" numberOfLines={1}>{aside}</Text></Box> : null}
          {action ? <Button label={action.label} onPress={action.onPress} variant="ghost" size="sm" /> : null}
        </Row>
      ) : null}
      {card ? <Card gap="md">{children}</Card> : children}
    </Box>
  );
}
