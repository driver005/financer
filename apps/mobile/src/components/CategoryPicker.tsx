import { Chip, ChipRow } from "@financer/ui";

import { categoryLabel } from "@/categoryIcons";
import { CATEGORIES } from "@/rules";

/** Pick one category; the chips wrap onto several lines. */
export function CategoryPicker({ value, onChange }: { value: string; onChange: (category: string) => void }) {
  return (
    <ChipRow>
      {CATEGORIES.map((cat) => (
        <Chip key={cat} label={categoryLabel(cat)} selected={cat === value} onPress={() => onChange(cat)} />
      ))}
    </ChipRow>
  );
}
