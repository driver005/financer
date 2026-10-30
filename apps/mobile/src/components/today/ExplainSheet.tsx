import { Modal, Pressable, ScrollView, Text as RNText, View } from "react-native";

import type { SafeToSpend } from "@/api/client";
import { ChunkyButton } from "@/components/kit";
import { Money } from "@/components/Money";
import { formatMoney, spokenMoney } from "@/format";
import { periodLabel } from "@/period";
import { breakdownRows, paceInfo } from "@/safeToSpend";
import { elevation, radius, space, tabular, typography, usePalette } from "@/theme";

/** Bottom sheet with the numbers behind the daily amount. */
export function ExplainSheet({ data, visible, onClose }: { data: SafeToSpend; visible: boolean; onClose: () => void }) {
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
