import type { ReactNode } from "react";

import { Box } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";

/** Nothing here yet: say what is missing and why, and offer at most one action. */
export function EmptyState({ icon = "text-search", title, message, action }: { icon?: IconName; title: string; message?: string; action?: ReactNode }) {
  return (
    <Box align="center" gap="md" py="3xl" px="lg" maxW="narrow">
      <Box dim="avatar-lg" radius="full" bg="sunken" align="center" justify="center">
        <Icon name={icon} size="lg" tone="muted" />
      </Box>
      <Text variant="heading" align="center" level={2}>{title}</Text>
      {message ? <Text variant="body" tone="muted" align="center">{message}</Text> : null}
      {action}
    </Box>
  );
}
