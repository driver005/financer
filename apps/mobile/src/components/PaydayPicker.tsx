import { Box, Chip, ChipRow, Text } from "@financer/ui";

import { budgetPeriod, localIsoDate, periodLabel } from "@/period";
import { tap } from "@/native/haptics";

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** Pick the day of the month your budget month starts on (1 = calendar month). */
export function PaydayPicker({ value, onChange }: { value: number; onChange: (day: number) => void }) {
  const label = periodLabel(budgetPeriod(localIsoDate(), value));
  return (
    <Box gap="sm">
      <ChipRow>
        {DAYS.map((day) => (
          <Chip
            key={day}
            label={String(day)}
            selected={day === value}
            onPress={() => {
              if (day === value) return;
              tap();
              onChange(day);
            }}
          />
        ))}
      </ChipRow>
      <Text variant="caption" tone="muted">
        {value === 1 ? `Your budget month is the calendar month (now ${label}).` : `Your budget month starts on day ${value}: now ${label}.`}
      </Text>
    </Box>
  );
}
