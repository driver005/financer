import type { ReactNode } from "react";

import { Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";

/** A quiet one-line note with an icon: what the app understood, a tip. Not a warning (that is a Banner). */
export function Hint({ icon = "auto-fix", children }: { icon?: IconName; children: ReactNode }) {
  return (
    <Row bg="sunken" radius="xl" px="md" py="sm" gap="sm" align="center">
      <Icon name={icon} size="md" tone="accent" />
      {typeof children === "string" ? <Text variant="label" tone="muted">{children}</Text> : children}
    </Row>
  );
}
