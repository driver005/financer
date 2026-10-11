import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { FlatList, View } from "react-native";
import { HelperText, IconButton, Text, TextInput } from "react-native-paper";

import type { Receipt } from "@/api/client";
import { useApi } from "@/api/config";
import { Body, Button, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";
import { toBase64 } from "@/native/base64";
import { pickFileBytes } from "@/native/files";
import { useScreenData } from "@/hooks";

export default function Receipts() {
  const { api, loaded } = useApi();
  const c = useColors();
  const { data, error, reload } = useScreenData((a) => a.receipts());
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const picked =
        source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
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

  if (!loaded) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <Title>Receipts</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => String(r.id)}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ marginBottom: 8 }}>
              <Text variant="bodyMedium" style={{ color: c.muted, marginBottom: 8 }}>
                Photograph a receipt, import a digital receipt PDF (a Rewe eBon or Lidl Plus receipt exported from their app), or paste the text. Photos and PDFs are read by your configured AI provider (Claude or
                OpenAI), so the image leaves your server; only do this if you are fine with that.
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Button label="Scan" icon="camera-outline" onPress={() => scan("camera")} disabled={busy} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Photo" icon="image-outline" mode="outlined" onPress={() => scan("library")} disabled={busy} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="PDF" icon="file-pdf-box" mode="outlined" onPress={scanPdf} disabled={busy} />
                </View>
              </View>
              <TextInput
                mode="outlined"
                label="Receipt text"
                accessibilityLabel="Receipt text"
                value={text}
                onChangeText={setText}
                multiline
                numberOfLines={6}
                style={{ minHeight: 120 }}
              />
              <View style={{ marginTop: 12 }}>
                <Button label={busy ? "Adding…" : "Add receipt"} icon="receipt-text-plus-outline" onPress={add} disabled={busy || !text.trim()} />
              </View>
              {message || error ? <HelperText type="info" visible>{message ?? error}</HelperText> : null}
            </View>
          }
          ListEmptyComponent={<Body muted>No receipts yet.</Body>}
          renderItem={({ item }) => (
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Body bold>{item.merchant ?? "Receipt"}</Body>
                  <Text variant="bodySmall" style={{ color: c.muted }}>
                    {item.date ? formatDate(item.date) : "no date"} · {item.items.length} items
                    {item.total_cents != null ? ` · ${formatCents(item.total_cents)}` : ""}
                    {item.reconciles ? "" : " · check"}
                  </Text>
                </View>
                <IconButton icon="delete-outline" onPress={() => remove(item)} accessibilityLabel="Delete receipt" />
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
