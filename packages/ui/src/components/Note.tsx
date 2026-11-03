import type { ReactNode } from "react";

import type { Tone } from "../constants/colors";
import { Box, Row } from "../primitives/Box";
import { Icon, type IconName } from "../primitives/Icon";
import { Text } from "../primitives/Text";

const ICON: Record<"error" | "ok" | "info", IconName> = { error: "alert-circle-outline", ok: "check-circle-outline", info: "information-outline" };
const TONE: Record<"error" | "ok" | "info", Tone | "neutral"> = { error: "danger", ok: "success", info: "neutral" };

/** An inline message under a field or a form: red for a problem, green for a success, quiet for a tip. */
export function Note({ tone = "info", children }: { tone?: "error" | "ok" | "info"; children: ReactNode }) {
  const t = TONE[tone];
  const ink = t === "neutral" ? "muted" : t;
  return (
    <Row gap="sm" align="start" accessibilityRole={tone === "error" ? "alert" : undefined}>
      <Icon name={ICON[tone]} size="sm" tone={ink} />
      <Box grow><Text variant="caption" tone={ink}>{children}</Text></Box>
    </Row>
  );
}
