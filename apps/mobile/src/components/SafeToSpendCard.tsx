import { useState } from "react";
import { Modal, Pressable, ScrollView, Text as RNText, View } from "react-native";

import type { SafeToSpend } from "@/api/client";
import { ChunkyButton } from "@/components/kit";
import { Money } from "@/components/Money";
import { Ring } from "@/components/Ring";
import { StatusPill, type Tone } from "@/components/rows";
import { useCountUp } from "@/components/motion";
import { Card } from "@/components/ui";
import { formatMoney, spokenMoney, splitMoney } from "@/format";
import { periodLabel } from "@/period";
import { heroFontSize, periodLeft } from "@/ring";
import { breakdownRows, daysLeftText, headlineHint, paceInfo } from "@/safeToSpend";
import { elevation, radius, space, tabular, typography, usePalette } from "@/theme";

const PACE_ICON = { good: "check-circle-outline", warn: "alert-outline", muted: "help-circle-outline" } as const;

/**
 * The number of the day, and the one hero figure of the Today screen: what you can spend per day
 * for the rest of the budget period, inside a ring that shows how much of the period is still
 * ahead. Below it the pace, the money left in the period and a link to the explanation sheet.
 */
export function SafeToSpendCard({ data }: { data: SafeToSpend | null }) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const shown = useCountUp(data?.daily_cents ?? 0);

  if (!data) {
    return (
      <Card>
        <Label>Safe to spend today</Label>
        <RNText style={[typography.body, { color: p.muted, marginTop: space.sm }]}>
          Not available right now. Check the connection to your server and pull the screen again.
        </RNText>
      </Card>
    );
  }

  const pace = paceInfo(data);
  const over = data.income_detected && data.available_cents < 0;
  const paceTone: Tone = pace.tone === "good" ? "good" : pace.tone === "warn" ? "warn" : "muted";
  const ringColor = over ? p.bad : pace.tone === "warn" ? p.orange : p.fill;
  const left = periodLeft(data.days_left, data.days_total);
  const parts = splitMoney(shown);
  const numberColour = over ? p.bad : p.text;
  const heroSize = heroFontSize(`${parts.sign}${parts.whole}`, 176, 48, 28);

  return (
    <>
      <Card>
        <Label>Safe to spend today</Label>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, marginTop: space.xs }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <RNText
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
              maxFontSizeMultiplier={1.2}
              style={{ color: numberColour, ...tabular, fontWeight: "900", fontSize: 22 }}
            >
              <RNText style={{ fontSize: heroSize, lineHeight: Math.round(heroSize * 1.14) }}>
                {parts.sign}
                {parts.whole}
              </RNText>
              ,{parts.fraction}&nbsp;€
            </RNText>
            <RNText style={[typography.label, { color: p.muted }]}>a day</RNText>
          </View>
          <Ring
            size={84}
            stroke={9}
            progress={left}
            color={ringColor}
            accessibilityLabel={`Safe to spend today: ${spokenMoney(data.daily_cents)} per day. ${data.days_left} of ${data.days_total} days left in this period.`}
          >
            <RNText style={[typography.bodyStrong, { color: p.text }]}>{data.days_left}</RNText>
            <RNText style={[typography.caption, { color: p.muted, fontSize: 12, lineHeight: 14 }]}>{data.days_left === 1 ? "day" : "days"}</RNText>
          </Ring>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm, marginTop: space.md }}>
          <StatusPill label={pace.title} tone={paceTone} icon={PACE_ICON[pace.tone]} accessibilityLabel={`Pace: ${pace.title}`} />
          <RNText style={[typography.caption, { color: p.muted }]}>{daysLeftText(data.days_left)}</RNText>
        </View>
        {/* "free for N days" is already in the rows below; the hint only speaks up when something is off */}
        {!data.income_detected || data.available_cents < 0 ? (
          <RNText style={[typography.caption, { color: p.muted, marginTop: space.sm }]}>{headlineHint(data)}</RNText>
        ) : null}

        <View style={{ marginTop: space.md, borderTopWidth: 1, borderTopColor: p.border }}>
          <LedgerRow label="Free this period" value={<Money cents={data.available_cents} variant="bodyStrong" tone={over ? "bad" : "plain"} />} />
          <View style={{ height: 1, backgroundColor: p.border }} />
          <LedgerRow label="Still to pay (fixed)" value={<Money cents={data.fixed_costs_due_cents} variant="bodyStrong" tone="plain" />} />
        </View>

        <View style={{ alignSelf: "flex-start", marginTop: space.xs, marginLeft: -space.sm }}>
          <ChunkyButton compact flat icon="help-circle-outline" label="How is this calculated?" onPress={() => setOpen(true)} />
        </View>
      </Card>
      <ExplainSheet data={data} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** One line of the ledger under the daily number: label on the left, amount on the right. */
function LedgerRow({ label, value }: { label: string; value: React.ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, minHeight: 44 }}>
      <RNText style={[typography.body, { color: p.muted, flexShrink: 1 }]}>{label}</RNText>
      {value}
    </View>
  );
}

function Label({ children }: { children: string }) {
  const p = usePalette();
  return <RNText style={[typography.overline, { color: p.muted }]}>{children}</RNText>;
}

/** Bottom sheet with the numbers behind the daily amount. */
function ExplainSheet({ data, visible, onClose }: { data: SafeToSpend; visible: boolean; onClose: () => void }) {
  const p = usePalette();
  const rows = breakdownRows(data);
  const pace = paceInfo(data);
  const label = periodLabel({ start: data.period_start, end: data.period_end });
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close explanation" />
        <View
          accessibilityViewIsModal
          style={[
            {
              backgroundColor: p.surface,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: p.border,
              maxHeight: "85%",
              paddingHorizontal: space.xl,
              paddingTop: space.lg,
              paddingBottom: space.xl,
            },
            elevation.overlay,
          ]}
        >
          <View style={{ alignSelf: "center", width: 44, height: 5, borderRadius: radius.pill, backgroundColor: p.border, marginBottom: space.md }} />
          <ScrollView showsVerticalScrollIndicator={false}>
            <RNText accessibilityRole="header" style={[typography.heading, { color: p.text }]}>
              How your daily number works
            </RNText>
            <RNText style={[typography.caption, { color: p.muted, marginTop: 2 }]}>Budget period {label}</RNText>

            <View style={{ marginTop: space.md }}>
              {rows.map((r) => (
                <View key={r.id} style={{ paddingVertical: space.sm }} accessibilityLabel={`${r.label}: ${spokenMoney(r.cents)}. ${r.hint}`}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
                    <RNText style={[typography.bodyStrong, { color: p.text, flex: 1 }]}>{r.label}</RNText>
                    <Money cents={r.cents} variant="bodyStrong" signed tone={r.cents < 0 ? "bad" : "good"} />
                  </View>
                  <RNText style={[typography.caption, { color: p.muted }]}>{r.hint}</RNText>
                </View>
              ))}
              <View style={{ height: 2, backgroundColor: p.border, marginVertical: space.sm }} />
              <Line label="Free to spend" value={formatMoney(data.available_cents)} />
              <Line label={`Divided by ${Math.max(1, data.days_left)} ${data.days_left <= 1 ? "day (today)" : "days left"}`} value={`${formatMoney(data.daily_cents)} a day`} />
            </View>

            <RNText style={[typography.bodyStrong, { color: p.text, marginTop: space.lg }]}>Pace: {pace.title}</RNText>
            <RNText style={[typography.caption, { color: p.muted, marginTop: 2 }]}>{pace.detail}</RNText>

            <RNText style={[typography.caption, { color: p.muted, marginTop: space.lg }]}>
              Based on recurring payments found in your bookings and your envelope limits. A payment that is long overdue is treated as
              stopped. This is a budget estimate, not your bank balance.
            </RNText>
            <View style={{ marginTop: space.lg }}>
              <ChunkyButton label="Got it" onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: space.xs, gap: space.md }}>
      <RNText style={[typography.bodyStrong, { color: p.text, flex: 1 }]}>{label}</RNText>
      <RNText style={[typography.bodyStrong, tabular, { color: p.text }]}>{value}</RNText>
    </View>
  );
}
