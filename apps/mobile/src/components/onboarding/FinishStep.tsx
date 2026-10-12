import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { Text as RNText, View } from "react-native";

import { useApi } from "@/api/config";
import { ChunkyButton, HelperText } from "@/components/kit";
import { FieldLabel, StepFrame } from "@/components/onboarding/Frame";
import type { StepCtx } from "@/components/onboarding/types";
import { celebrate } from "@/native/haptics";
import { firstQuest, mascotFor, recapRows } from "@/onboarding";
import { applyDraft } from "@/onboardingApply";
import { localIsoDate } from "@/period";
import { usePalette } from "@/theme";

type Saved = { kind: "nothing" } | { kind: "waiting" } | { kind: "saving" } | { kind: "ok" } | { kind: "failed"; error: string };

export function FinishStep({ ctx }: { ctx: StepCtx }) {
  const { api, mode } = useApi();
  const p = usePalette();
  const [saved, setSaved] = useState<Saved>({ kind: "waiting" });
  const done = useRef(false);
  const quest = firstQuest(ctx.draft);
  const rows = recapRows(ctx.draft, ctx.build);

  useEffect(() => {
    celebrate();
  }, []);

  // Write the answers to the backend. With the on-phone backend the API appears a moment after
  // the mode is switched on, so this runs again when it does.
  async function save() {
    if (!api) {
      setSaved({ kind: mode === "embedded" ? "waiting" : "nothing" });
      return;
    }
    setSaved({ kind: "saving" });
    const r = await applyDraft(api, ctx.draft, localIsoDate());
    done.current = r.ok;
    setSaved(r.ok ? { kind: "ok" } : { kind: "failed", error: r.error });
  }

  useEffect(() => {
    if (!done.current) void save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const status =
    saved.kind === "ok"
      ? "Your answers are saved to the backend."
      : saved.kind === "saving"
        ? "Saving your answers…"
        : saved.kind === "waiting"
          ? "Waiting for the on-phone backend to start…"
          : saved.kind === "failed"
            ? `Could not save to the backend: ${saved.error}. You can set payday, budget and habits in Settings and Budget.`
            : "Not connected to a backend, so payday, budget and habits were not saved. Connect in Settings, or replay the setup there.";

  return (
    <StepFrame
      fraction={ctx.fraction}
      stepLabel={ctx.stepLabel}
      onBack={ctx.back}
      backIsClose={ctx.backIsClose}
      mascot={mascotFor("finish", ctx.draft, ctx.build)}
      title="You're all set!"
      primary={{ label: quest.title, onPress: () => ctx.finish(quest.route), icon: "flag-checkered" }}
      onSkip={() => ctx.finish("/")}
      skipLabel="Go to Today"
      confetti
    >
      {rows.length ? (
        <>
          <FieldLabel>Your choices</FieldLabel>
          <View style={{ borderRadius: 20, borderWidth: 2, borderColor: p.border, backgroundColor: p.surface, paddingHorizontal: 14, paddingVertical: 6 }}>
            {rows.map((r, i) => (
              <View
                key={r.label}
                style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: p.border }}
                accessibilityLabel={`${r.label}: ${r.value}`}
              >
                <RNText style={{ color: p.muted, fontSize: 14 }}>{r.label}</RNText>
                <RNText style={{ color: p.text, fontSize: 14, fontWeight: "800", flexShrink: 1, textAlign: "right" }}>{r.value}</RNText>
              </View>
            ))}
          </View>
        </>
      ) : (
        <RNText style={{ color: p.muted, fontSize: 15 }}>You skipped every question. Nothing was changed, and you can set it all up later in Settings.</RNText>
      )}
      <HelperText type={saved.kind === "failed" ? "error" : "info"} visible>{status}</HelperText>
      {saved.kind === "failed" ? <ChunkyButton outline icon="refresh" label="Try saving again" onPress={() => void save()} /> : null}

      <FieldLabel>Your first quest</FieldLabel>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center", padding: 14, borderRadius: 20, borderWidth: 2, borderColor: p.accent, backgroundColor: p.surfaceAlt }}>
        <MaterialCommunityIcons name="flag-checkered" size={28} color={p.accent} />
        <View style={{ flex: 1 }}>
          <RNText style={{ color: p.text, fontSize: 16, fontWeight: "800" }}>{quest.title}</RNText>
          <RNText style={{ color: p.muted, fontSize: 14 }}>{quest.hint}</RNText>
        </View>
      </View>
    </StepFrame>
  );
}
