import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Badge, Banner, Box, Button, Card, IconBadge, IconButton, Money, Note, Row, Text, TextField, TileButton, VirtualList } from "@financer/ui";

import type { Receipt } from "@/api/client";
import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { chainTone, initials, mealTone } from "@/groceryView";
import { formatDate } from "@/format";
import { toBase64 } from "@/native/base64";
import { pickFileBytes } from "@/native/files";
import { useScreenData } from "@/hooks";

export default function Receipts() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const { data, error, reload } = useScreenData((a) => a.receipts());
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  async function add() {
    if (!api || !text.trim()) return;
    setBusy(true);
    try {
      const r = await api.uploadReceipt(text);
      setMessage(
        r.duplicate
          ? "This receipt was already added."
          : r.reconciles
            ? `Added ${r.items.length} items; they add up to the total.`
            : `Added ${r.items.length} items, but they do not add up to the printed total. Check the text for missing lines.`,
      );
      setText("");
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not add receipt");
    } finally {
      setBusy(false);
    }
  }

  async function scanPdf() {
    if (!api) return;
    try {
      const bytes = await pickFileBytes(["application/pdf"]);
      if (bytes === null) return;
      setBusy(true);
      setMessage("Reading the receipt… (the file is sent to your configured AI provider)");
      const r = await api.scanReceipt(toBase64(bytes), "application/pdf");
      setMessage(
        r.receipt.duplicate
          ? "This receipt was already added."
          : `Added ${r.receipt.items.length} items${r.receipt.reconciles ? "; they add up to the total." : ", but they do not add up to the printed total. Check the receipt."}`,
      );
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not read the PDF");
    } finally {
      setBusy(false);
    }
  }

  async function scan(source: "camera" | "library") {
    if (!api) return;
    try {
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setMessage("Camera permission was denied. Allow it in the system settings, or choose a photo instead.");
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, base64: true };
      const picked = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset.base64) {
        setMessage("Could not read the photo.");
        return;
      }
      setBusy(true);
      setMessage("Reading the receipt… (the photo is sent to your configured AI provider)");
      const mime = asset.mimeType && ["image/jpeg", "image/png", "image/webp"].includes(asset.mimeType) ? asset.mimeType : "image/jpeg";
      const r = await api.scanReceipt(asset.base64, mime);
      setMessage(
        r.receipt.duplicate
          ? "This receipt was already added."
          : r.receipt.reconciles
            ? `Added ${r.receipt.items.length} items; they add up to the total.`
            : `Added ${r.receipt.items.length} items, but they do not add up to the printed total. Compare with the transcript:\n\n${r.text}`,
      );
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not scan the receipt");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Receipt) {
    if (!api || r.id == null) return;
    try {
      await api.deleteReceipt(r.id);
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not delete");
    }
  }

  if (!loaded) return <Page title="Receipts"><Loading /></Page>;
  if (!api) return <Page title="Receipts"><NeedsSetup /></Page>;

  const loading = !data && !error;
  const pasteVisible = pasteOpen || text.trim() !== "";

  return (
    <Page title="Receipts" subtitle="Receipts show what you really buy and pay." fixed>
      <VirtualList
        data={data ?? []}
        keyExtractor={(r) => String(r.id)}
        header={
          <Box gap="md">
            <Row gap="sm" align="stretch">
              <TileButton icon="camera-outline" label="Scan" hint="Camera" disabled={busy} onPress={() => scan("camera")} primary />
              <TileButton icon="image-outline" label="Photo" hint="From gallery" disabled={busy} onPress={() => scan("library")} />
              <TileButton icon="file-pdf-box" label="PDF" hint="eBon, Lidl Plus" disabled={busy} onPress={scanPdf} />
            </Row>
            <Note>Photos and PDFs are read by your configured AI provider (Claude or OpenAI), so the image leaves your server; only do this if you are fine with that.</Note>

            {pasteVisible ? (
              <Card gap="md">
                <TextField label="Receipt text" value={text} onChangeText={setText} multiline />
                <Button label={busy ? "Adding…" : "Add receipt"} icon="receipt-text-plus-outline" onPress={add} disabled={busy || !text.trim()} />
              </Card>
            ) : null}

            <Row gap="xs" wrap>
              {pasteVisible ? null : <Button size="sm" variant="ghost" label="Paste receipt text" icon="text-box-plus-outline" onPress={() => setPasteOpen(true)} />}
              <Button size="sm" variant="ghost" label="Receipt sources" icon="email-sync-outline" onPress={() => router.push("/receipt-sources")} />
            </Row>

            {message ? <Banner tone="info">{message}</Banner> : null}
            {error ? <Banner tone="danger">{error}</Banner> : null}
            {loading ? <Loading rows={3} /> : null}
            {data && data.length > 0 ? <Text variant="label" tone="muted">{`${data.length} receipt${data.length === 1 ? "" : "s"}`}</Text> : null}
          </Box>
        }
        empty={
          loading ? undefined : (
            <Empty title="No receipts yet" message="Scan your first receipt and Financer learns what you buy and where it is cheapest." actionLabel="Scan a receipt" actionIcon="camera-outline" onAction={() => void scan("camera")} />
          )
        }
        renderItem={(item) => (
          <Card>
            <Row gap="md">
              <IconBadge tone={item.chain ? chainTone(item.chain) : mealTone(item.merchant ?? "Receipt")} text={initials(item.merchant ?? "Receipt")} />
              <Box grow gap="2xs">
                <Text variant="bodyStrong" numberOfLines={1}>{item.merchant ?? "Receipt"}</Text>
                <Text variant="caption" tone="muted">{`${item.date ? formatDate(item.date) : "no date"} · ${item.items.length} items`}</Text>
                {!item.reconciles ? <Row><Badge tone="danger" icon="alert-outline" label="Check: items differ from total" lines={2} /></Row> : null}
              </Box>
              {item.total_cents != null ? <Money cents={item.total_cents} variant="price" tone="plain" /> : null}
              <IconButton icon="delete-outline" label="Delete receipt" onPress={() => remove(item)} />
            </Row>
          </Card>
        )}
      />
    </Page>
  );
}
