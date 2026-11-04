import { useRouter } from "expo-router";
import { File } from "expo-file-system";
import { useShareIntentContext } from "expo-share-intent";
import { useMemo, useState } from "react";
import { Banner, Button, Card, Stack, Text } from "@financer/ui";

import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { NeedsSetup } from "@/components/Status";
import { toBase64 } from "@/native/base64";
import { classifyShare, fileUri, holdCsv } from "@/shareImport";

/**
 * Something was shared to Financer from another app: a receipt as a PDF or a screenshot (the dm,
 * Rossmann, Edeka, Netto or Penny apps keep theirs inside the app and can share them), a receipt as
 * text, or an order list as a CSV. The receipt is read by your configured AI provider like any
 * other scanned receipt, and nothing is sent anywhere before you tap the button.
 */
export default function Share() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const { shareIntent, resetShareIntent } = useShareIntentContext();
  const what = useMemo(() => classifyShare(shareIntent), [shareIntent]);
  const [message, setMessage] = useState<{ tone: "info" | "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function close() {
    resetShareIntent();
    router.replace("/receipts");
  }

  if (loaded && !api) {
    return (
      <Page title="Shared with Financer">
        <NeedsSetup />
      </Page>
    );
  }

  async function read() {
    if (!api) return;
    setBusy(true);
    try {
      if (what.kind === "pdf" || what.kind === "image") {
        setMessage({ tone: "info", text: "Reading the receipt… (the file is sent to your configured AI provider)" });
        const bytes = await new File(fileUri(what.path)).arrayBuffer();
        const r = await api.scanReceipt(toBase64(bytes), what.kind === "pdf" ? "application/pdf" : what.mime);
        setMessage({
          tone: "success",
          text: r.receipt.duplicate ? "This receipt was already added." : `Added ${r.receipt.items.length} items${r.receipt.reconciles ? "; they add up to the total." : ", but they do not add up to the printed total. Check the receipt."}`,
        });
      } else if (what.kind === "text") {
        const r = await api.uploadReceipt(what.text);
        setMessage({ tone: "success", text: r.duplicate ? "This receipt was already added." : `Added ${r.items.length} items${r.reconciles ? "; they add up to the total." : ", but they do not add up to the printed total."}` });
      } else if (what.kind === "csv") {
        const text = new TextDecoder().decode(await new File(fileUri(what.path)).arrayBuffer());
        holdCsv(what.name, text);
        resetShareIntent();
        router.replace("/orders-import");
      }
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof Error ? e.message : "Could not read it." });
    } finally {
      setBusy(false);
    }
  }

  const title = what.kind === "pdf" || what.kind === "image" ? `Receipt: ${what.name}` : what.kind === "csv" ? `Order list: ${what.name}` : what.kind === "text" ? "A receipt as text" : "Shared with Financer";
  const action = what.kind === "csv" ? "Open as an order list" : "Read this receipt";
  return (
    <Page title="Shared with Financer">
      <Stack gap="lg">
        {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
        <Card gap="md">
          <Text variant="heading" level={2}>{title}</Text>
          {what.kind === "none" ? <Text tone="muted">Nothing was shared, or it has already been dealt with.</Text> : null}
          {what.kind === "link" ? <Text tone="muted">That is a link. A link cannot be read: open the receipt in its app and share the receipt itself (a PDF, or a screenshot).</Text> : null}
          {what.kind === "unsupported" ? <Text tone="muted">{`Financer cannot read ${what.what}. Share a PDF, a JPEG or PNG screenshot, or text.`}</Text> : null}
          {what.kind === "pdf" || what.kind === "image" || what.kind === "text" ? <Text tone="muted">It goes through the same reading as a scanned receipt: your configured AI provider reads it, and the items are stored once.</Text> : null}
          {what.kind === "csv" ? <Text tone="muted">An order history file (Amazon's data request, for example). You see what was found before anything is stored.</Text> : null}
          {what.kind === "pdf" || what.kind === "image" || what.kind === "text" || what.kind === "csv" ? <Button label={busy ? "Working…" : action} icon="receipt-text-outline" onPress={() => void read()} disabled={busy || message?.tone === "success"} /> : null}
          <Button label={message?.tone === "success" ? "Done" : "Cancel"} variant="ghost" onPress={close} />
        </Card>
      </Stack>
    </Page>
  );
}
