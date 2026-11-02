import type { ReactNode } from "react";

import { IconButton } from "../components/Button";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";

/** The title row of a page: back button, title, actions. */
export function TopBar({ title, subtitle, onBack, actions }: { title: string; subtitle?: string; onBack?: () => void; actions?: ReactNode }) {
  return (
    <Row gap="sm" px={{ base: "md", md: "lg" }} py="sm" bg="surface" control="lg">
      {onBack ? <IconButton icon="arrow-left" label="Back" onPress={onBack} /> : null}
      <Box grow gap="none">
        <Text variant="subheading" level={1} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text variant="caption" tone="muted" numberOfLines={1}>{subtitle}</Text> : null}
      </Box>
      {actions}
    </Row>
  );
}
