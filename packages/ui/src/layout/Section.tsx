import type { ReactNode } from "react";

import { Button } from "../components/Button";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";

/** A titled block of a page, with an optional link-style action on the right. */
export function Section({ title, description, action, children }: { title?: string; description?: string; action?: { label: string; onPress: () => void }; children: ReactNode }) {
  return (
    <Box gap="md">
      {title || action ? (
        <Row justify="between" gap="md">
          <Box grow gap="2xs">
            {title ? <Text variant="heading" level={2}>{title}</Text> : null}
            {description ? <Text variant="body" tone="muted">{description}</Text> : null}
          </Box>
          {action ? <Button label={action.label} onPress={action.onPress} variant="ghost" size="sm" /> : null}
        </Row>
      ) : null}
      {children}
    </Box>
  );
}
