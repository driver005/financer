import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, Card, Group, Note, Row, Section, Spinner, Text, TextField, ToggleRow } from "@financer/ui";

import { ApiError } from "@/api/client";
import { liveSyncMissing } from "@/bankConnections";
import { useApi } from "@/api/config";
import { deleteSecret, getSecret, setSecret } from "@/api/storage";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { Page } from "@/components/Page";
import { formatCents, formatDate } from "@/format";
import { useScreenData } from "@/hooks";
import { blzProblem, ibanProblem } from "@/settingsPlan";

const PIN_KEY = "financer.bank-pin";
const POLL_MS = 3000;
const GIVE_UP_MS = 10 * 60 * 1000;

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
      const started = await api.startSync({ blz, user_id: userId, pin, iban });
      setPhase({ kind: "waiting", challenge: started.no_tan_required ? "" : started.challenge });

      const deadline = Date.now() + GIVE_UP_MS;
      while (!cancelled.current && Date.now() < deadline) {
        try {
          const done = await api.confirmSync(started.sync_id);
          const balance = done.balance_cents != null ? ` Balance ${formatCents(done.balance_cents)}${done.balance_date ? ` (${formatDate(done.balance_date)})` : ""}.` : "";
          setPhase({ kind: "done", text: `Imported ${done.imported} new transactions, ${done.duplicates} were already known.${balance}` });
          await reload();
          return;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            continue;
          }
          throw e;
        }
      }
      if (!cancelled.current) setPhase({ kind: "error", text: "Timed out waiting for the approval. Start again." });
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
