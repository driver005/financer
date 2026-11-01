import { useState } from "react";

import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { OptionList, type Option } from "../components/OptionList";
import { Sheet } from "../layout/Sheet";
import { Box, Row } from "../primitives/Box";

export type AppliedFilter = { key: string; label: string };

export type FilterBarProps<S extends string> = {
  /** The filters that are on, shown as chips that can be removed (they orient the person). */
  applied: readonly AppliedFilter[];
  onRemove: (key: string) => void;
  /** Opens the full filter UI (a sheet on a phone). */
  onOpenFilters?: () => void;
  sort?: { value: S; options: readonly Option<S>[]; onChange: (v: S) => void };
  /** How many results, shown at the end. */
  resultLabel?: string;
};

/** The row above a list: Filters, the applied filter chips, and Sort. */
export function FilterBar<S extends string>({ applied, onRemove, onOpenFilters, sort, resultLabel }: FilterBarProps<S>) {
  const [sortOpen, setSortOpen] = useState(false);
  const current = sort?.options.find((o) => o.value === sort.value)?.label;
  return (
    <Box gap="sm">
      <Row gap="sm" wrap>
        {onOpenFilters ? <Button label={applied.length ? `Filters (${applied.length})` : "Filters"} icon="tune-variant" variant="outline" tone="neutral" size="sm" onPress={onOpenFilters} /> : null}
        {sort ? <Button label={`Sort: ${current ?? ""}`} icon="sort" variant="outline" tone="neutral" size="sm" onPress={() => setSortOpen(true)} /> : null}
        {applied.map((f) => <Chip key={f.key} label={f.label} onRemove={() => onRemove(f.key)} />)}
      </Row>
      {sort ? (
        <Sheet visible={sortOpen} onClose={() => setSortOpen(false)} title="Sort">
          <OptionList options={sort.options} value={sort.value} onChange={(v) => { sort.onChange(v); setSortOpen(false); }} />
        </Sheet>
      ) : null}
      {resultLabel ? <Box><Row><Chip label={resultLabel} /></Row></Box> : null}
    </Box>
  );
}
