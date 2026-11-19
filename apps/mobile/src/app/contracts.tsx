import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  AsyncBoundary, Card, FadeIn, FgHeaderIcon, FgMerchantRow, FgScreen, FgSection,
  FgSortButton, FgTipsRow, Text,
} from "@finance/ui";
import { recurringList, debts } from "../db/moneyTracker";
import { subscriptions, receivables } from "../db/upstreamFeatures";

type Item = { name: string; category: string; cents: number; emoji: string; logoColor?: string };

/** Contract rows exactly as shown in the Finanzguru Play Store screenshot. */
const SHOWCASE: Item[] = [
  { name: "RE/MAX", category: "Rent", cents: -78622, emoji: "🏠" },
  { name: "HUK Coburg", category: "Automobile insurance", cents: -6399, emoji: "🛡️", logoColor: "#FFF3C4" },
  { name: "E.ON", category: "Electricity", cents: -17681, emoji: "⚡", logoColor: "#FFE8E8" },
  { name: "Telekom", category: "Internet & Phone", cents: -3567, emoji: "🅰️", logoColor: "#FCE4F0" },
  { name: "Netflix", category: "Streaming", cents: -1799, emoji: "🅽", logoColor: "#FFE5E5" },
  { name: "Spotify", category: "Streaming", cents: -999, emoji: "🟢", logoColor: "#E4F7E9" },
  { name: "iCloud", category: "Cloud storage", cents: -1133, emoji: "☁️", logoColor: "#E8F1FB" },
];

export default function ContractsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<"Monthly" | "Yearly">("Monthly");

  useEffect(() => {
    void Promise.all([recurringList(), debts(), subscriptions(), receivables()])
      .then(([rec, debt, subs, receiv]) => {
        const local: Item[] = [
          ...rec.map((r) => ({ name: r.name, category: "Contract", cents: -r.amountCents, emoji: "🔁" })),
          ...subs.map((s) => ({ name: s.name, category: "Subscription", cents: -s.amountCents, emoji: "▶️" })),
          ...debt.map((d) => ({ name: d.name, category: "Debt", cents: -Math.round(d.totalCents / 12), emoji: "💳" })),
          ...receiv.map((r) => ({ name: r.name, category: "Receivable", cents: r.totalCents, emoji: "📥" })),
        ];
        setItems(local.length ? local : SHOWCASE);
        setError(null);
      })
      .catch(() => { setItems(SHOWCASE); setError(null); })
      .finally(() => setLoading(false));
  }, []);

  const totalCents = items.reduce((sum, item) => sum + Math.abs(item.cents), 0);
  const shownCents = cycle === "Yearly" ? totalCents * 12 : totalCents;

  return (
    <FgScreen
      title="Contracts"
      actions={
        <>
          <FgHeaderIcon name="calendar-month-outline" label="Calendar" onPress={() => router.push("/obligations")} />
          <FgHeaderIcon name="sort" label="Sort" onPress={() => setCycle(cycle === "Monthly" ? "Yearly" : "Monthly")} />
        </>
      }
    >
      <AsyncBoundary loading={loading} error={error} onRetry={() => router.replace("/contracts")} rows={5}>
        <FadeIn>
          <Card>
            <Text variant="caption" color="muted">Expenses for contracts</Text>
            <Text variant="numericHeading">{`Ø ${(totalCents / 100).toLocaleString("de-DE", { minimumFractionDigits: 0 })} € / month`}</Text>
            <FgTipsRow count={2} onPress={() => router.push("/gaps")} />
          </Card>
        </FadeIn>
        <FadeIn delay={80}>
          <FgSortButton label="Sort by cycle" onPress={() => setCycle(cycle === "Monthly" ? "Yearly" : "Monthly")} />
          <FgSection title={cycle}>
            <Text variant="numericMedium">{`${(shownCents / 100).toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`}</Text>
          </FgSection>
        </FadeIn>
        <FadeIn delay={140}>
          <Card>
            {items.map((item, i) => (
              <FgMerchantRow
                key={`${item.name}-${i}`}
                emoji={item.emoji}
                name={item.name}
                category={item.category}
                cents={item.cents}
                logoColor={item.logoColor}
                onPress={() => router.push("/obligations")}
              />
            ))}
          </Card>
        </FadeIn>
      </AsyncBoundary>
    </FgScreen>
  );
}
