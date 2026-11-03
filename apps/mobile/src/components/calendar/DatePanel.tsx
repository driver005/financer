import { useState } from "react";
import { MiniMonth } from "@financer/ui";

import { WEEKDAY_SHORT, addMonths, monthFirst, monthTitle } from "@/calendar";
import { miniCells } from "@/calendarView";
import { localIsoDate } from "@/period";

/** A month to pick a date from: it opens on the month of the current value. */
export function DatePanel({ value, onPick }: { value: string; onPick: (date: string) => void }) {
  const [month, setMonth] = useState(monthFirst(value));
  return (
    <MiniMonth
      title={monthTitle(month)}
      weekdays={WEEKDAY_SHORT.map((w) => w.slice(0, 2))}
      weeks={miniCells(month, localIsoDate(), value, [])}
      onSelect={onPick}
      onPrev={() => setMonth(addMonths(month, -1))}
      onNext={() => setMonth(addMonths(month, 1))}
    />
  );
}
