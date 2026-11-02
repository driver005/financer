import { Badge } from "../components/Badge";

export type Verdict = "none" | "fair" | "good" | "great";

const LABEL: Record<Verdict, string> = { none: "No deal", fair: "Slightly below usual", good: "Good deal", great: "Great deal" };

/** The verdict on a price. Hidden for "none": no deal is the normal state, not a flaw. */
export function DealBadge({ verdict, discountPct }: { verdict: Verdict; discountPct?: number }) {
  if (verdict === "none") return null;
  const pct = discountPct && discountPct >= 1 ? ` −${Math.round(discountPct)} %` : "";
  return <Badge label={`${LABEL[verdict]}${pct}`} tone={verdict === "fair" ? "info" : "success"} icon="tag-outline" solid={verdict === "great"} />;
}
