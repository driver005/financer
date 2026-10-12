import { Pressable, Text as RNText, View } from "react-native";

import { budgetPeriod, localIsoDate, periodLabel } from "@/period";
import { tap } from "@/native/haptics";
import { usePalette } from "@/theme";

const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/** Pick the day of the month your budget month starts on (1 = calendar month). */
export function PaydayPicker({ value, onChange }: { value: number; onChange: (day: number) => void }) {
  const p = usePalette();
  const label = periodLabel(budgetPeriod(localIsoDate(), value));
  return (
    <View>
      <View
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12 }}
        accessibilityRole="radiogroup"
        accessibilityLabel="Payday, day of the month"
      >
        {DAYS.map((day) => {
          const on = day === value;
          return (
            <Pressable
              key={day}
              onPress={() => {
                if (on) return;
                tap();
                onChange(day);
              }}
              accessibilityRole="radio"
              accessibilityLabel={day === 1 ? "Day 1, calendar month" : `Day ${day}`}
              accessibilityState={{ checked: on }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 2,
                borderColor: on ? p.accent : p.border,
                backgroundColor: on ? p.accent : p.surface,
              }}
            >
              <RNText style={{ color: on ? p.onAccent : p.text, fontWeight: "800", fontSize: 14 }}>{day}</RNText>
            </Pressable>
          );
        })}
      </View>
      <RNText style={{ color: p.muted, fontSize: 13, marginTop: 8 }}>
        {value === 1
          ? `Your budget month is the calendar month (now ${label}).`
          : `Your budget month starts on day ${value}: now ${label}.`}
      </RNText>
    </View>
  );
}
