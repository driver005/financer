import type { ReactNode } from "react";

import type { Tone } from "../constants/colors";
import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";

const ICON: Record<Tone, IconName> = {
  neutral: "information-outline",
  accent: "information-outline",
  success: "check-circle-outline",
  warning: "alert-outline",
  danger: "alert-circle-outline",
  info: "information-outline",
};

export type BannerProps = { children: ReactNode; title?: string; tone?: Tone; action?: ReactNode };

/** A message inside the page: something to know, to fix or to confirm, with an optional action. */
export function Banner({ children, title, tone = "info", action }: BannerProps) {
  const text = `on-${tone}-soft` as const;
  return (
    <Row bg={`${tone}-soft`} radius="2xl" p="lg" gap="md" border="thick" borderTone={tone} align="start" accessibilityRole="alert">
      <Icon name={ICON[tone]} size="lg" tone={text} />
      <Box grow gap="sm">
        {title ? <Text variant="bodyStrong" tone={text}>{title}</Text> : null}
        {typeof children === "string" ? <Text variant="body" tone={text}>{children}</Text> : children}
        {action}
      </Box>
    </Row>
  );
}
