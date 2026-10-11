import { ScrollView, View } from "react-native";

import { Chip } from "@/components/kit";
import { CATEGORIES } from "@/rules";

/**
 * Pick one category. Wraps onto several lines by default; `horizontal` makes a single row that
 * scrolls, for places that repeat the picker (one per split part).
 */
export function CategoryPicker({
  value,
  onChange,
  horizontal,
}: {
  value: string;
  onChange: (category: string) => void;
  horizontal?: boolean;
}) {
  const chips = CATEGORIES.map((cat) => (
    <Chip key={cat} compact selected={cat === value} onPress={() => onChange(cat)} accessibilityLabel={`Category ${cat}`}>
      {cat}
    </Chip>
  ));
  if (horizontal) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", gap: 6 }}>{chips}</View>
      </ScrollView>
    );
  }
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{chips}</View>;
}
