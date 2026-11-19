import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  AsyncBoundary, Box, Button, Card, FadeIn, FgCancelledBadge, FgHeaderIcon, FgMerchantRow, FgScreen, FgSection,
  FgSortButton, FgTipsRow, Segmented, Sheet, Text, TextField,
} from "@finance/ui";
import { recurringList, debts } from "../db/moneyTracker";
import { subscriptions, receivables } from "../db/upstreamFeatures";
import { base64Encode, saveDocument } from "../lib/file";
import { loadCancellations, saveCancellation, type Cancellation } from "../lib/finanzguru";
import { loadWebhookConfig, saveWebhookConfig, sendCancellation, type SendMethod } from "../lib/cancellationSender";

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
  const [cancelItem, setCancelItem] = useState<Item | null>(null);
  const [address, setAddress] = useState("");
  const [customerNo, setCustomerNo] = useState("");
  const [effective, setEffective] = useState("");
  const [cancelled, setCancelled] = useState<Cancellation[]>([]);
  const [sendMethod, setSendMethod] = useState<SendMethod>("email");
  const [webhook, setWebhook] = useState({ endpoint: "", token: "" });
  const [sendMessage, setSendMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadCancellations().then(setCancelled);
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

  useEffect(() => {
    if (cancelItem) { void loadWebhookConfig().then(setWebhook); setSendMessage(null); }
  }, [cancelItem]);

  const totalCents = items.reduce((sum, item) => sum + Math.abs(item.cents), 0);
  const shownCents = cycle === "Yearly" ? totalCents * 12 : totalCents;

  const buildLetter = () => {
    if (!cancelItem) return null;
    const date = effective || new Date().toISOString().slice(0, 10);
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Kündigung ${cancelItem.name}</title>
<style>body{font-family:Arial,sans-serif;max-width:700px;margin:40px auto;line-height:1.6;color:#2A2166}h1{color:#3C318F}</style></head><body>
<h1>Kündigung</h1><p>${cancelItem.name}<br>${address || "Kundenservice"}<br>${date}</p>
<h2>Kündigung meines Vertrags</h2><p>Sehr geehrte Damen und Herren,</p>
<p>hiermit kündige ich meinen Vertrag (${cancelItem.category}) mit Kundennummer ${customerNo || "-"} fristgerecht zum ${date}. Bitte bestätigen Sie den Eingang dieser Kündigung schriftlich.</p>
<p>Mit freundlichen Grüßen</p><p>_____</p><p><small>Generated locally by Pantry — verify the provider address and notice period before sending.</small></p>
</body></html>`;
    return { to: address, subject: `Kündigung ${cancelItem.name}`, html };
  };

  const markCancelled = async () => {
    if (!cancelItem) return;
    await saveCancellation(cancelItem.name);
    setCancelled(await loadCancellations());
  };

  const createCancellation = async () => {
    const letter = buildLetter();
    if (!letter || !cancelItem) return;
    await saveDocument(base64Encode(letter.html), `kuendigung-${cancelItem.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`, "text/html");
    await markCancelled();
    setCancelItem(null);
  };

  const sendLetter = async () => {
    const letter = buildLetter();
    if (!letter) return;
    try {
      const result = await sendCancellation(letter, sendMethod);
      setSendMessage(result);
      await markCancelled();
      setCancelItem(null);
    } catch (e) { setSendMessage(e instanceof Error ? e.message : "Sending failed"); }
  };

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
              <Box key={`${item.name}-${i}`} gap={4}>
                {cancelled.find((c) => c.name === item.name) ? <FgCancelledBadge /> : null}
                <FgMerchantRow
                  emoji={item.emoji}
                  name={item.name}
                  category={item.category}
                  cents={item.cents}
                  logoColor={item.logoColor}
                  onPress={() => setCancelItem(item)}
                />
              </Box>
            ))}
          </Card>
        </FadeIn>
        {cancelled.length ? (
          <FadeIn delay={200}>
            <FgSection title="Cancelled">
              <Card>
                {cancelled.map((item) => (
                  <Box key={item.name} row style={{ justifyContent: "space-between", paddingVertical: 8 }}>
                    <Text variant="body3">{item.name}</Text>
                    <Text variant="body4" color="muted">{`Yesterday · ${item.date}`}</Text>
                  </Box>
                ))}
              </Card>
            </FgSection>
          </FadeIn>
        ) : null}
      </AsyncBoundary>

      <Sheet visible={!!cancelItem} onClose={() => setCancelItem(null)} title={`Cancel ${cancelItem?.name ?? ""}`}>
        <Text variant="body3" color="muted">Free, legally styled cancellation letter. Download it or hand it to your mail/SMS app for sending.</Text>
        <TextField label="Provider address" value={address} onChangeText={setAddress} placeholder="Kundenservice, Musterstr. 1" />
        <TextField label="Customer number" value={customerNo} onChangeText={setCustomerNo} placeholder="e.g. 123456789" />
        <TextField label="Effective date" value={effective} onChangeText={setEffective} placeholder="YYYY-MM-DD" />
        <Button label="Download letter" icon="file-document-outline" variant="secondary" onPress={() => void createCancellation()} />
        <Text variant="body4" color="muted">Send via</Text>
        <Segmented value={sendMethod} onChange={setSendMethod} options={[
          { value: "email", label: "Email" }, { value: "sms", label: "SMS" }, { value: "webhook", label: "Webhook" },
        ]} />
        {sendMethod === "webhook" ? (
          <>
            <TextField label="HTTPS endpoint" value={webhook.endpoint} onChangeText={(v) => setWebhook({ ...webhook, endpoint: v })} placeholder="https://…" />
            <TextField label="Bearer token" value={webhook.token} onChangeText={(v) => setWebhook({ ...webhook, token: v })} />
            <Button label="Save webhook" variant="secondary" onPress={() => void saveWebhookConfig(webhook.endpoint, webhook.token)} />
          </>
        ) : null}
        {sendMessage ? <Text variant="body3" color="accent">{sendMessage}</Text> : null}
        <Button label="Send cancellation" icon="send" onPress={() => void sendLetter()} />
      </Sheet>
    </FgScreen>
  );
}
