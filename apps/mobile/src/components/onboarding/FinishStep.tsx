import { useEffect, useRef, useState } from "react";
import { Box, Button, Card, Divider, Icon, Note as Message, Row, Text } from "@financer/ui";

import { useApi } from "@/api/config";
import { FieldLabel, StepFrame } from "@/components/onboarding/Frame";
import type { StepCtx } from "@/components/onboarding/types";
import { celebrate } from "@/native/haptics";
import { firstQuest, mascotFor, recapRows } from "@/onboarding";
import { applyDraft } from "@/onboardingApply";
import { localIsoDate } from "@/period";

type Saved = { kind: "nothing" } | { kind: "waiting" } | { kind: "saving" } | { kind: "ok" } | { kind: "failed"; error: string };

export function FinishStep({ ctx }: { ctx: StepCtx }) {
  const { api, mode } = useApi();
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
          <Card gap="sm">
            {rows.map((r, i) => (
              <Box key={r.label} gap="sm">
                {i > 0 ? <Divider /> : null}
                <Row justify="between" gap="md" accessible accessibilityLabel={`${r.label}: ${r.value}`}>
                  <Text variant="label" tone="muted">{r.label}</Text>
                  <Box shrink><Text variant="label" align="right">{r.value}</Text></Box>
                </Row>
              </Box>
            ))}
          </Card>
        </>
      ) : (
        <Text variant="body" tone="muted">You skipped every question. Nothing was changed, and you can set it all up later in Settings.</Text>
      )}
      <Message tone={saved.kind === "failed" ? "error" : "info"}>{status}</Message>
      {saved.kind === "failed" ? <Button variant="outline" icon="refresh" label="Try saving again" onPress={() => void save()} /> : null}

      <FieldLabel>Your first quest</FieldLabel>
      <Card tone="accent">
        <Row gap="md">
          <Icon name="flag-checkered" size="xl" tone="on-accent-soft" />
          <Box grow>
            <Text variant="bodyStrong" tone="on-accent-soft">{quest.title}</Text>
            <Text variant="label" tone="on-accent-soft">{quest.hint}</Text>
          </Box>
        </Row>
      </Card>
    </StepFrame>
  );
}
