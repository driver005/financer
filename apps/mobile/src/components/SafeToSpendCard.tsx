import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text as RNText, View } from "react-native";

import type { SafeToSpend } from "@/api/client";
import { ChunkyButton } from "@/components/kit";
import { Card } from "@/components/ui";
import { formatCents } from "@/format";
import { periodLabel } from "@/period";
import { breakdownRows, daysLeftText, headlineHint, paceInfo } from "@/safeToSpend";
import { usePalette } from "@/theme";

/** The number of the day: what you can spend per day for the rest of the budget period. */
export function SafeToSpendCard({ data }: { data: SafeToSpend | null }) {
  const p = usePalette();
  const [open, setOpen] = useState(false);

  if (!data) {
    return (
      <Card>
        <Label>SAFE TO SPEND TODAY</Label>
        <RNText style={{ color: p.muted, fontSize: 14, marginTop: 6 }}>
          Not available right now. Check the connection to your server and pull the screen again.
        </RNText>
      </Card>
    );
  }

  const pace = paceInfo(data);
  const paceColor = pace.tone === "good" ? p.good : pace.tone === "warn" ? p.orange : p.muted;
  const over = data.income_detected && data.available_cents < 0;

  return (
    <>
      <Card>
        <Label>SAFE TO SPEND TODAY</Label>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 4 }}>
          <RNText
            accessibilityLabel={`Safe to spend today: ${formatCents(data.daily_cents)} per day`}
            style={{ color: over ? p.bad : p.text, fontSize: 40, fontWeight: "900" }}
          >
            {formatCents(data.daily_cents)}
          </RNText>
          <RNText style={{ color: p.muted, fontSize: 16, fontWeight: "700" }}>a day</RNText>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
          <View
            accessibilityLabel={`Pace: ${pace.title}`}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              borderRadius: 12,
              borderWidth: 2,
              borderColor: paceColor,
              paddingHorizontal: 8,
              paddingVertical: 2,
            }}
          >
            <MaterialCommunityIcons
              name={pace.tone === "good" ? "check-circle-outline" : pace.tone === "warn" ? "alert-outline" : "help-circle-outline"}
              size={14}
              color={paceColor}
            />
            <RNText style={{ color: paceColor, fontSize: 12, fontWeight: "800" }}>{pace.title}</RNText>
          </View>
          <RNText style={{ color: p.muted, fontSize: 13 }}>{daysLeftText(data.days_left)}</RNText>
        </View>
        <RNText style={{ color: p.muted, fontSize: 13, marginTop: 8 }}>{headlineHint(data)}</RNText>
        <View style={{ marginTop: 12 }}>
          <ChunkyButton compact outline icon="help-circle-outline" label="How is this calculated?" onPress={() => setOpen(true)} />
        </View>
      </Card>
      <ExplainSheet data={data} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function Label({ children }: { children: string }) {
  const p = usePalette();
  return <RNText style={{ color: p.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>{children}</RNText>;
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
          style={{
            backgroundColor: p.surface,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderWidth: 2,
            borderBottomWidth: 0,
            borderColor: p.border,
            maxHeight: "85%",
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: 24,
          }}
        >
          <View style={{ alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: p.border, marginBottom: 12 }} />
          <ScrollView showsVerticalScrollIndicator={false}>
            <RNText accessibilityRole="header" style={{ color: p.text, fontSize: 22, fontWeight: "800" }}>
              How your daily number works
            </RNText>
            <RNText style={{ color: p.muted, fontSize: 13, marginTop: 2 }}>Budget period {label}</RNText>

            <View style={{ marginTop: 14 }}>
              {rows.map((r) => (
                <View key={r.id} style={{ paddingVertical: 8 }} accessibilityLabel={`${r.label}: ${formatCents(r.cents)}. ${r.hint}`}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                    <RNText style={{ color: p.text, fontSize: 16, fontWeight: "700", flex: 1 }}>{r.label}</RNText>
                    <RNText style={{ color: r.cents < 0 ? p.bad : p.good, fontSize: 16, fontWeight: "800" }}>
                      {r.cents > 0 ? "+" : ""}
                      {formatCents(r.cents)}
                    </RNText>
                  </View>
                  <RNText style={{ color: p.muted, fontSize: 12 }}>{r.hint}</RNText>
                </View>
              ))}
              <View style={{ height: 2, backgroundColor: p.border, marginVertical: 6 }} />
              <Line label="Free to spend" value={formatCents(data.available_cents)} strong />
              <Line label={`Divided by ${Math.max(1, data.days_left)} ${data.days_left <= 1 ? "day (today)" : "days left"}`} value={`${formatCents(data.daily_cents)} a day`} strong />
            </View>

            <RNText style={{ color: p.text, fontSize: 16, fontWeight: "800", marginTop: 16 }}>Pace: {pace.title}</RNText>
            <RNText style={{ color: p.muted, fontSize: 13, marginTop: 2 }}>{pace.detail}</RNText>

            <RNText style={{ color: p.muted, fontSize: 12, marginTop: 16 }}>
              Based on recurring payments found in your bookings and your envelope limits. A payment that is long overdue is treated as
              stopped. This is a budget estimate, not your bank balance.
            </RNText>
            <View style={{ marginTop: 16 }}>
              <ChunkyButton label="Got it" onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: 12 }}>
      <RNText style={{ color: p.text, fontSize: 16, fontWeight: strong ? "800" : "500", flex: 1 }}>{label}</RNText>
      <RNText style={{ color: p.text, fontSize: 16, fontWeight: strong ? "800" : "500" }}>{value}</RNText>
    </View>
  );
}
