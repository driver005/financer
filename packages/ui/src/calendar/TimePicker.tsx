import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { Chip, ChipRow } from "../components/Chip";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Picks a time of day: the hour, then the minute in steps. The value is `HH:MM`. Chips (not a wheel)
 * so it works the same on a phone, a tablet and the web and with a screen reader.
 */
export function TimePicker({ value, onChange, step = 5 }: { value: string; onChange: (time: string) => void; step?: number }) {
  const [h, m] = value.split(":").map(Number);
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  return (
    <Box gap="md">
      <Text variant="label" tone="muted">Hour</Text>
      <ChipRow>
        {HOURS.map((x) => (
          <Chip key={x} label={pad(x)} selected={x === h} onPress={() => onChange(`${pad(x)}:${pad(m)}`)} />
        ))}
      </ChipRow>
      <Text variant="label" tone="muted">Minute</Text>
      <Row wrap gap="sm">
        {minutes.map((x) => (
          <Chip key={x} label={pad(x)} selected={x === m} onPress={() => onChange(`${pad(h)}:${pad(x)}`)} />
        ))}
      </Row>
    </Box>
  );
}
