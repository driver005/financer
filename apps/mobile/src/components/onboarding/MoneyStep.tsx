import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useApi } from "@/api/config";
import { ChunkyButton, Text } from "@/components/kit";
import { FieldMessage } from "@/components/settings/SettingsKit";
import { Note, StepFrame } from "@/components/onboarding/Frame";
import type { StepCtx } from "@/components/onboarding/types";
import { Card, useColors } from "@/components/ui";
import { pickFileBytes } from "@/native/files";
import { mascotFor, nextStep, stepsFor } from "@/onboarding";
import { applyDraft } from "@/onboardingApply";
import { demoExport, demoGate } from "@/onboardingDemo";
import { localIsoDate } from "@/period";

type Message = { text: string; error: boolean };

/** Connect your money: all of it optional, none of it needed to finish. */
export function MoneyStep({ ctx }: { ctx: StepCtx }) {
  const { api, mode } = useApi();
  const router = useRouter();
  const c = useColors();
  const { draft, update } = ctx;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [mixOk, setMixOk] = useState(false);

  const onPhone = (draft.backend ?? (mode === "embedded" ? "embedded" : "server")) === "embedded";

  async function importCsv() {
    if (!api) return;
    if (draft.demoLoaded && !mixOk) {
      setMixOk(true);
      setMessage({
        error: false,
        text: "The demo bookings are already in. Your real bookings will be added next to them and the demo ones stay (they are marked DEMO). Press the button again to import anyway.",
      });
      return;
    }
    try {
      const bytes = await pickFileBytes(["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain"]);
      if (bytes === null) return;
      setBusy(true);
      const r = await api.importCsv(bytes);
      update({ csvImported: (draft.csvImported ?? 0) + r.imported });
      const skipped = r.skipped.length ? `, ${r.skipped.length} unreadable` : "";
      setMessage({ error: false, text: `Imported ${r.imported} new bookings, ${r.duplicates} already known${skipped}.` });
    } catch (e) {
      setMessage({ error: true, text: e instanceof Error ? e.message : "Import failed" });
    } finally {
      setBusy(false);
    }
  }

  async function loadDemo() {
    if (!api) return;
    setBusy(true);
    setMessage(null);
    try {
      const today = localIsoDate();
      // payday and the grocery goal first, so the demo bookings land in the period you chose
      await applyDraft(api, draft, today);
      const gate = demoGate(await api.transactions());
      if (!gate.allowed) {
        setMessage({ error: false, text: gate.reason ?? "Demo data is not offered here." });
        return;
      }
      const r = await api.importData(demoExport(today, draft.payday ?? 1, draft.chains ?? []));
      update({ demoLoaded: true });
      setMessage({ error: false, text: `Loaded ${r.transactions_added} demo bookings. Every one is labelled [DEMO]; open Today to see them at work.` });
    } catch (e) {
      setMessage({ error: true, text: e instanceof Error ? e.message : "Could not load the demo data" });
    } finally {
      setBusy(false);
      setConfirmDemo(false);
    }
  }

  function openBankSync() {
    // Save the setup at the step after this one: the sync screen is part of the app, not of the setup.
    const after = nextStep(stepsFor(ctx.build), "money");
    if (after) ctx.goto(after);
    router.push("/sync");
  }

  const offline = !api;

  return (
    <StepFrame
      fraction={ctx.fraction}
      stepLabel={ctx.stepLabel}
      onBack={ctx.back}
      backIsClose={ctx.backIsClose}
      mascot={mascotFor("money", draft, ctx.build)}
      title="Connect your money"
      why="Numbers need bookings. Choose one way to bring them in, or skip all of it and add them later from the Spending tab."
      primary={{ label: "Continue", onPress: ctx.next, icon: "arrow-right" }}
      onSkip={ctx.next}
    >
      <Card>
        <Text variant="titleMedium">Sync with your bank</Text>
        <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
          Pulls your Sparkasse bookings over FinTS. It needs a FinTS product ID, a free registration with the Deutsche Kreditwirtschaft that can take weeks, so most people start with a CSV. You approve each sync in your pushTAN app.{" "}
          {onPhone
            ? "With the on-phone backend your PIN never leaves the phone."
            : "Your PIN goes to your own server for the sync only and is never stored there."}{" "}
          Financer does not keep it unless you switch "remember" on in the sync screen.
        </Text>
        <View style={{ marginTop: 12 }}>
          <ChunkyButton outline icon="bank-transfer" label="Open bank sync" onPress={openBankSync} />
        </View>
        <Text variant="bodySmall" style={{ color: c.muted, marginTop: 6 }}>
          This leaves the setup; your answers are saved and it picks up again the next time the app starts.
        </Text>
      </Card>

      <Card>
        <Text variant="titleMedium">Import a CSV</Text>
        <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
          Export your bookings from Sparkasse online banking as CSV and pick the file. Importing the same file twice changes nothing.
        </Text>
        <View style={{ marginTop: 12 }}>
          <ChunkyButton
            outline
            icon="file-delimited-outline"
            label={mixOk && draft.demoLoaded ? "Import anyway" : "Pick a CSV file"}
            onPress={() => void importCsv()}
            disabled={busy || offline}
          />
        </View>
        {(draft.csvImported ?? 0) > 0 ? <FieldMessage tone="info">{draft.csvImported} bookings imported so far.</FieldMessage> : null}
      </Card>

      <Card>
        <Text variant="titleMedium">Try with demo data</Text>
        <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
          Loads about four months of invented bookings (a salary, rent, a subscription, grocery trips) so Today is alive before you link anything. Every booking is labelled [DEMO]. It is only offered while there are no bookings yet, and it never touches your budget or your list of usual items.
        </Text>
        <Note icon="alert-outline">
          Be aware: Financer cannot delete bookings yet, so demo bookings stay until you start with an empty database. If you want to link your bank for real, skip this.
        </Note>
        {confirmDemo ? (
          <View style={{ marginTop: 12, gap: 4 }}>
            <ChunkyButton icon="check" label={busy ? "Loading…" : "Yes, load the demo data"} onPress={() => void loadDemo()} disabled={busy} />
            <ChunkyButton flat label="Cancel" onPress={() => setConfirmDemo(false)} disabled={busy} />
          </View>
        ) : (
          <View style={{ marginTop: 12 }}>
            <ChunkyButton
              outline
              icon="test-tube"
              label={draft.demoLoaded ? "Demo data loaded" : "Try with demo data"}
              onPress={() => setConfirmDemo(true)}
              disabled={busy || offline || !!draft.demoLoaded}
            />
          </View>
        )}
      </Card>

      {offline ? (
        <FieldMessage tone="info">
          Importing and the demo need a connected backend. Go back one step to connect, or skip this for now.
        </FieldMessage>
      ) : null}
      {message ? <FieldMessage tone={message.error ? "error" : "ok"}>{message.text}</FieldMessage> : null}
    </StepFrame>
  );
}
