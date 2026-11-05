import type { ReactNode } from "react";

import { splitMoney, spokenMoney } from "../format";
import { Box, Row, Stack } from "../primitives/Box";
import { Text } from "../primitives/Text";

/**
 * The figure a money screen is about, set big and centred on the page itself (no card behind it),
 * with a small label above, whole euros large and the cents and the euro sign small, then a chip
 * (the change) and one sentence. The modern finance apps open with exactly this and nothing else.
 */
export function Balance({ label, cents, chip, caption, spoken }: { label: string; cents: number; chip?: ReactNode; caption?: string; spoken?: string }) {
  const parts = splitMoney(cents);
  return (
    <Stack align="center" gap="xs" accessible accessibilityLabel={spoken ?? `${label}: ${spokenMoney(cents)}`}>
      <Text variant="label" tone="muted" align="center">{label}</Text>
      <Row gap="2xs" align="baseline" justify="center">
        <Box shrink>
          <Text variant="display" align="center" fit>{`${parts.sign}${parts.whole}`}</Text>
        </Box>
        <Text variant="subheading" tone="muted">{`,${parts.fraction} €`}</Text>
      </Row>
      {chip}
      {caption ? <Text variant="caption" tone="muted" align="center">{caption}</Text> : null}
    </Stack>
  );
}
