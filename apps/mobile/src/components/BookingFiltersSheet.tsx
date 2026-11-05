import { useEffect, useState } from "react";
import { Box, Button, Chip, ChipRow, OptionList, Row, Section, Segmented, Sheet, Text, TextField } from "@financer/ui";

import { formatCents, parseEuroInput } from "@/format";
import { NO_FILTERS, PRESETS, SORTS, TX_FILTERS, type BookingFilters } from "@/spendingView";

export type CategoryOption = { key: string; label: string; count: number };

const euros = (cents: number | null) => (cents === null ? "" : formatCents(cents).replace(/\s?€$/, ""));

/**
 * All the ways to narrow the Spending list in one sheet: what kind (in or out), which period, which
 * categories (any number), how much (from and to) and the order. Changes apply to the list at once,
 * so the button at the foot can say how many bookings are left.
 */
export function BookingFiltersSheet({
  visible,
  onClose,
  filters,
  onChange,
  categories,
  resultCount,
}: {
  visible: boolean;
  onClose: () => void;
  filters: BookingFilters;
  onChange: (f: BookingFilters) => void;
  categories: CategoryOption[];
  resultCount: number;
}) {
  const [low, setLow] = useState(euros(filters.min_cents));
  const [high, setHigh] = useState(euros(filters.max_cents));
  // the boxes follow the filters when they are cleared from outside (a chip, "Reset")
  useEffect(() => {
    setLow(euros(filters.min_cents));
    setHigh(euros(filters.max_cents));
  }, [filters.min_cents, filters.max_cents]);

  const lowBad = low.trim() !== "" && parseEuroInput(low) === null;
  const highBad = high.trim() !== "" && parseEuroInput(high) === null;
  const set = (patch: Partial<BookingFilters>) => onChange({ ...filters, ...patch });
  const toggle = (key: string) => set({ categories: filters.categories.includes(key) ? filters.categories.filter((c) => c !== key) : [...filters.categories, key] });

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Filter bookings"
      footer={
        <Row gap="md">
          <Button label="Reset" variant="outline" onPress={() => onChange({ ...NO_FILTERS, query: filters.query })} />
          <Box grow>
            <Button label={`Show ${resultCount} ${resultCount === 1 ? "booking" : "bookings"}`} onPress={onClose} />
          </Box>
        </Row>
      }
    >
      <Box gap="xl" px="xl" pb="lg">
        <Section title="Money" quiet>
          <Segmented value={filters.kind} onChange={(kind) => set({ kind })} options={TX_FILTERS} />
        </Section>

        <Section title="Period" quiet>
          <ChipRow>
            {PRESETS.map((p) => (
              <Chip key={p.value} label={p.label} selected={filters.preset === p.value} onPress={() => set({ preset: p.value })} />
            ))}
          </ChipRow>
        </Section>

        {categories.length > 0 ? (
          <Section title="Categories" quiet>
            <ChipRow>
              {categories.map((c) => (
                <Chip key={c.key} label={`${c.label} · ${c.count}`} selected={filters.categories.includes(c.key)} onPress={() => toggle(c.key)} />
              ))}
            </ChipRow>
          </Section>
        ) : null}

        <Section title="Amount" quiet>
          <Row gap="md" align="start">
            <Box grow>
              <TextField
                label="At least"
                value={low}
                onChangeText={(t) => {
                  setLow(t);
                  set({ min_cents: t.trim() === "" ? null : parseEuroInput(t) });
                }}
                keyboardType="decimal-pad"
                right={<Text variant="label" tone="muted">€</Text>}
                error={lowBad ? "Like 5 or 5,50" : undefined}
              />
            </Box>
            <Box grow>
              <TextField
                label="At most"
                value={high}
                onChangeText={(t) => {
                  setHigh(t);
                  set({ max_cents: t.trim() === "" ? null : parseEuroInput(t) });
                }}
                keyboardType="decimal-pad"
                right={<Text variant="label" tone="muted">€</Text>}
                error={highBad ? "Like 5 or 5,50" : undefined}
              />
            </Box>
          </Row>
        </Section>

        <Section title="Order" quiet>
          <OptionList options={SORTS} value={filters.sort} onChange={(sort) => set({ sort })} />
        </Section>
      </Box>
    </Sheet>
  );
}
