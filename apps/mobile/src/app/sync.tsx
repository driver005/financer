import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Card, Group, Note, Row, Section, Spinner, Text, TextField, ToggleRow } from "@financer/ui";

import { isRunning, liveSyncMissing, syncResultText, waitForSync } from "@/bankConnections";
import { useApi } from "@/api/config";
import { deleteSecret, getSecret, setSecret } from "@/api/storage";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { Page } from "@/components/Page";
import { formatCents, formatDate } from "@/format";
import { useScreenData } from "@/hooks";
import { blzProblem, ibanProblem } from "@/settingsPlan";

const PIN_KEY = "financer.bank-pin";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Phase = { kind: "idle" } | { kind: "waiting"; challenge: string } | { kind: "done"; text: string } | { kind: "error"; text: string };

export default function Sync() {
  const { api, loaded, mode } = useApi();
  const missing = liveSyncMissing(mode === "embedded");
  const router = useRouter();
  const { data: status, reload } = useScreenData((a) => a.bankStatus());
  const [blz, setBlz] = useState("");
  const [userId, setUserId] = useState("");
  const [iban, setIban] = useState("");
  const [pin, setPin] = useState("");
  const [rememberPin, setRememberPin] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const cancelled = useRef(false);
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    if (status) {
      setBlz((v) => v || status.blz || "");
      setUserId((v) => v || status.user_id || "");
      setIban((v) => v || status.iban || "");
    }
  }, [status]);

  useEffect(() => {
    getSecret(PIN_KEY).then((p) => {
      if (p) {
        setPin(p);
        setRememberPin(true);
      }
    });
    return () => {
      cancelled.current = true;
    };
  }, []);

  const start = useCallback(async () => {
    if (!api) return;
    cancelled.current = false;
    try {
      if (rememberPin) await setSecret(PIN_KEY, pin);
      else await deleteSecret(PIN_KEY);
      // the same call as for every provider: a login sent with the request
      const started = await api.startSync({ kind: "fints", login: { blz, user_id: userId, iban }, pin });
      idRef.current = started.id;
      const final = await waitForSync(started, (id) => api.syncStatus(id), sleep, {
        cancelled: () => cancelled.current,
        onUpdate: (s) => {
          if (isRunning(s)) setPhase({ kind: "waiting", challenge: s.state === "needs_approval" ? (s.message ?? "") : "" });
        },
      });
      if (cancelled.current) return;
      if (isRunning(final)) {
        setPhase({ kind: "error", text: "Timed out waiting for the approval. Start again." });
        return;
      }
      const text = syncResultText(final) ?? "Sync failed";
      if (final.state === "error") setPhase({ kind: "error", text });
      else {
        setPhase({ kind: "done", text });
        await reload();
      }
    } catch (e) {
      setPhase({ kind: "error", text: e instanceof Error ? e.message : "Sync failed" });
    }
  }, [api, blz, userId, pin, iban, rememberPin, reload]);

  if (!loaded) return <Page title="Sync with Sparkasse"><Loading /></Page>;
  if (!api) return <Page title="Sync with Sparkasse"><NeedsSetup /></Page>;

  const waiting = phase.kind === "waiting";
  const ready = blz.trim() && userId.trim() && iban.trim() && pin;

  return (
    <Page title="Sync with Sparkasse">
      {status && !status.configured ? (
        // the form cannot work without the FinTS setup, so say so and offer what does work
        <Empty title={missing.title} message={missing.body} actionLabel="Import a CSV instead" actionIcon="file-delimited-outline" onAction={() => router.push("/spending")} />
      ) : (
        <>
          {status?.balance_cents != null ? (
            <Card gap="xs">
              <Text variant="subheading">Last known balance</Text>
              <Text variant="title">{formatCents(status.balance_cents)}</Text>
              <Text variant="caption" tone="muted">
                {status.balance_date ? `as of ${formatDate(status.balance_date)}` : ""}
                {status.last_sync_at ? ` · synced ${new Date(status.last_sync_at * 1000).toLocaleString("de-DE")}` : ""}
              </Text>
            </Card>
          ) : null}

          <Section title="Your Sparkasse account" card>
            <TextField label="Bank code (BLZ)" value={blz} onChangeText={setBlz} keyboardType="number-pad" error={blzProblem(blz) ?? undefined} />
            <TextField label="Online banking login" value={userId} onChangeText={setUserId} />
            <TextField label="IBAN" value={iban} onChangeText={setIban} capitalize="characters" error={ibanProblem(iban) ?? undefined} />
            <TextField label="PIN" value={pin} onChangeText={setPin} secure />
            <Group>
              <ToggleRow icon="lock-outline" title="Remember the PIN on this device" subtitle="Kept in this device's secure storage, never on the server." value={rememberPin} onChange={setRememberPin} />
            </Group>
            <Note>The PIN goes to your server only for the sync and is never stored there. Only pushTAN (approval in the Sparkasse app) is supported.</Note>
            <Button label={waiting ? "Waiting for approval…" : "Sync now"} icon="bank-transfer" onPress={start} disabled={waiting || !ready} />
          </Section>

          {phase.kind === "waiting" ? (
            <Card gap="sm">
              <Row gap="md">
                <Spinner />
                <Box grow><Text variant="body">{phase.challenge || "Fetching…"}</Text></Box>
              </Row>
              <Text variant="caption" tone="muted">Open your Sparkasse app and approve the request. This page checks every few seconds.</Text>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => {
                  cancelled.current = true;
                  if (idRef.current) void api.cancelSync(idRef.current).catch(() => {});
                  setPhase({ kind: "idle" });
                }}
              />
            </Card>
          ) : null}
          {phase.kind === "done" ? <Note tone="ok">{phase.text}</Note> : null}
          {phase.kind === "error" ? <Note tone="error">{phase.text}</Note> : null}
        </>
      )}
    </Page>
  );
}
