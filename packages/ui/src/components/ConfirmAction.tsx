import { useState } from "react";

import { Box } from "../primitives/Box";
import { Text } from "../primitives/Text";
import type { IconName } from "../primitives/Icon";
import { Button } from "./Button";
import { Card } from "./Card";

/**
 * A destructive action that asks first: the button turns into a question with the consequence spelled
 * out, a red confirm button and a Cancel.
 */
export function ConfirmAction({ label, icon, question, consequence, confirmLabel, onConfirm, disabled }: { label: string; icon?: IconName; question: string; consequence: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <Button label={label} icon={icon} tone="danger" variant="outline" onPress={() => setArmed(true)} disabled={disabled} />;
  return (
    <Card tone="danger" gap="sm">
      <Box accessibilityRole="alert" gap="xs">
        <Text variant="bodyStrong" tone="on-danger-soft">{question}</Text>
        <Text variant="label" tone="on-danger-soft">{consequence}</Text>
      </Box>
      <Button label={confirmLabel} icon={icon} tone="danger" onPress={() => { setArmed(false); onConfirm(); }} />
      <Button label="Cancel" variant="ghost" onPress={() => setArmed(false)} />
    </Card>
  );
}
