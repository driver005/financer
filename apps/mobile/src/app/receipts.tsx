import * as ImagePicker from "expo-image-picker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Text as RNText, View } from "react-native";

import type { Receipt } from "@/api/client";
import { useApi } from "@/api/config";
import { Avatar, Badge, EmptyState, Money, Panel, RoundIcon, SectionLabel, SkeletonCards, Subtitle, Tap, space, useTones } from "@/components/grocery/primitives";
import { ChunkyButton, Text, TextInput } from "@/components/kit";
import { Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import { chainTint, initials, mealTint } from "@/groceryView";
import { usePalette } from "@/theme";
import { formatCents, formatDate } from "@/format";
import { toBase64 } from "@/native/base64";
import { pickFileBytes } from "@/native/files";
import { useScreenData } from "@/hooks";

export default function Receipts() {
  const { api, loaded } = useApi();
  const p = usePalette();
  const router = useRouter();
  const tones = useTones();
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

  const loading = !data && !error;
  const pasteVisible = pasteOpen || text.trim() !== "";

  return (
    <Screen>
      <Title>Receipts</Title>
      {api ? <Subtitle>Receipts show what you really buy and pay.</Subtitle> : null}
      {!api ? (
        <NeedsSetup />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => String(r.id)}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: space.xl }}
          ListHeaderComponent={
            <View style={{ marginBottom: space.sm }}>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <CaptureTile icon="camera-outline" label="Scan" hint="Camera" disabled={busy} onPress={() => scan("camera")} accessibilityLabel="Scan a receipt with the camera" primary />
                <CaptureTile icon="image-outline" label="Photo" hint="From gallery" disabled={busy} onPress={() => scan("library")} accessibilityLabel="Add a receipt from a photo" />
                <CaptureTile icon="file-pdf-box" label="PDF" hint="eBon, Lidl Plus" disabled={busy} onPress={scanPdf} accessibilityLabel="Add a receipt from a PDF" />
              </View>

              <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.md, marginBottom: space.md }}>
                <MaterialCommunityIcons name="shield-lock-outline" size={18} color={p.muted} style={{ marginTop: 2 }} />
                <Text variant="bodySmall" style={{ color: p.muted, flex: 1 }}>
                  Photos and PDFs are read by your configured AI provider (Claude or OpenAI), so the image leaves your server; only do this if you are fine with that.
                </Text>
              </View>

              {pasteVisible ? (
                <Panel>
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
                  <View style={{ marginTop: space.md }}>
                    <ChunkyButton label={busy ? "Adding…" : "Add receipt"} icon="receipt-text-plus-outline" onPress={add} disabled={busy || !text.trim()} />
                  </View>
                </Panel>
              ) : (
                <ChunkyButton label="Paste receipt text" icon="text-box-plus-outline" outline onPress={() => setPasteOpen(true)} />
              )}

              <View style={{ marginTop: space.sm }}>
                <ChunkyButton label="Receipt sources" icon="email-sync-outline" outline onPress={() => router.push("/receipt-sources")} accessibilityLabel="Open receipt sources: mailbox, Lidl Plus and a watched folder" />
              </View>

              {message || error ? (
                <Panel tone={message ? "accent" : "bad"} padding={space.md} style={{ marginTop: space.md, marginBottom: 0 }}>
                  <View accessibilityRole="alert" style={{ flexDirection: "row", gap: space.sm }}>
                    <MaterialCommunityIcons name={message ? "information-outline" : "alert-circle-outline"} size={20} color={message ? tones.accent.fg : tones.bad.fg} />
                    <Text variant="bodyMedium" style={{ flex: 1 }}>{message ?? error}</Text>
                  </View>
                </Panel>
              ) : null}

              {loading ? (
                <View style={{ marginTop: space.lg }}>
                  <SkeletonCards count={3} label="Loading receipts" />
                </View>
              ) : null}
              {data && data.length > 0 ? <SectionLabel>{`${data.length} receipt${data.length === 1 ? "" : "s"}`}</SectionLabel> : <View style={{ height: space.md }} />}
            </View>
          }
          ListEmptyComponent={
            loading ? undefined : (
              <EmptyState
                title="No receipts yet"
                body="Scan your first receipt and Financer learns what you buy and where it is cheapest."
                actionLabel="Scan a receipt"
                actionIcon="camera-outline"
                onAction={() => void scan("camera")}
              />
            )
          }
          renderItem={({ item }) => (
            <Panel padding={space.md} style={{ marginBottom: space.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <Avatar tint={item.chain ? chainTint(item.chain) : mealTint(item.merchant ?? "Receipt")} label={initials(item.merchant ?? "Receipt")} size={44} />
                <View style={{ flex: 1, gap: 2 }}>
                  <RNText style={{ color: p.text, fontSize: 16, fontWeight: "700" }} numberOfLines={1}>
                    {item.merchant ?? "Receipt"}
                  </RNText>
                  <RNText style={{ color: p.muted, fontSize: 13, fontVariant: ["tabular-nums"] }}>
                    {item.date ? formatDate(item.date) : "no date"} · {item.items.length} items
                  </RNText>
                  {!item.reconciles ? <Badge tone="bad" icon="alert-outline" label="Check: items differ from total" /> : null}
                </View>
                {item.total_cents != null ? <Money text={formatCents(item.total_cents)} size="lg" /> : null}
                <RoundIcon icon="delete-outline" onPress={() => remove(item)} label="Delete receipt" />
              </View>
            </Panel>
          )}
        />
      )}
    </Screen>
  );
}

/** A big button for one way to add a receipt: icon, name and a hint. */
function CaptureTile({
  icon,
  label,
  hint,
  onPress,
  disabled,
  primary,
  accessibilityLabel,
}: {
  icon: string;
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  accessibilityLabel: string;
}) {
  const p = usePalette();
  const fg = primary ? p.onAccent : p.accent;
  return (
    <Tap
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      style={{
        flex: 1,
        minHeight: 92,
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
        paddingHorizontal: space.sm,
        borderRadius: 20,
        backgroundColor: primary ? p.accent : p.surface,
        borderWidth: 1,
        borderColor: primary ? p.accent : p.border,
        borderBottomWidth: 1,
        borderBottomColor: primary ? p.accentEdge : p.border,
      }}
    >
      <MaterialCommunityIcons name={icon as never} size={28} color={fg} />
      <RNText style={{ color: primary ? p.onAccent : p.text, fontSize: 14, fontWeight: "700" }}>{label}</RNText>
      <RNText style={{ color: primary ? p.onAccent : p.muted, fontSize: 11 }} numberOfLines={1}>
        {hint}
      </RNText>
    </Tap>
  );
}
