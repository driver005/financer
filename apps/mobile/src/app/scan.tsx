import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ScrollView, Text as RNText, View } from "react-native";

import type { EanLookup } from "@/api/client";
import { useApi } from "@/api/config";
import { BarcodeScanner, cameraAvailable } from "@/components/BarcodeScanner";
import { ChainPriceRow } from "@/components/grocery/ChainPriceRow";
import { Group, Panel, SectionLabel, SkeletonCards, Subtitle, space, useTones } from "@/components/grocery/primitives";
import { ScanFrame } from "@/components/grocery/ScanFrame";
import { ChunkyButton, HelperText, Text, TextInput } from "@/components/kit";
import { Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { tap } from "@/native/haptics";
import { ScanGate, chainRows, checkEan, headline, observationLine, planAddToUsual, productTitle } from "@/scan";
import { usePalette } from "@/theme";

export default function Scan() {
  const { api, loaded } = useApi();
  const c = useColors();
  const gate = useRef(new ScanGate()).current;
  const [cameraOn, setCameraOn] = useState(false);
  const [manual, setManual] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EanLookup | null>(null);
  const [usualMessage, setUsualMessage] = useState<string | null>(null);

  // Tabs stay mounted when you leave them: switch the camera off, or it keeps running behind.
  useFocusEffect(
    useCallback(() => {
      return () => setCameraOn(false);
    }, []),
  );

  const lookup = useCallback(
    async (code: string) => {
      if (!api) return;
      setBusy(true);
      setError(null);
      setUsualMessage(null);
      setCameraOn(false);
      try {
        const r = await api.eanLookup(code);
        setResult(r);
        tap();
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : "The lookup failed");
      } finally {
        setBusy(false);
        gate.done();
      }
    },
    [api, gate],
  );

  const onCameraCode = useCallback(
    (data: string) => {
      const code = gate.accept(data, Date.now());
      if (code) void lookup(code);
    },
    [gate, lookup],
  );

  function submitManual() {
    const check = checkEan(manual);
    if (!check.ok) {
      setInputError(check.reason);
      return;
    }
    setInputError(null);
    // typing the same number again is a deliberate repeat, not a camera echo
    gate.reset();
    gate.accept(check.code, Date.now());
    void lookup(check.code);
  }

  async function addToUsual(item: string) {
    if (!api) return;
    try {
      const plan = planAddToUsual(await api.basket(), item);
      if (plan.status === "already") {
        setUsualMessage("Already in your usual items.");
        return;
      }
      await api.saveBasket(plan.items);
      setUsualMessage(`Added to your usual items.${plan.note ? ` ${plan.note}` : ""}`);
    } catch (e) {
      setUsualMessage(e instanceof Error ? e.message : "Could not save");
    }
  }

  if (!loaded) return <Screen><Loading /></Screen>;

  const hasCamera = cameraAvailable();
  const showResult = result && !busy;

  return (
    <Screen>
      <Title>Scan a product</Title>
      {api ? <Subtitle>See which chain sells it cheapest.</Subtitle> : null}
      {!api ? (
        <NeedsSetup />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.xl }}>
          {hasCamera && cameraOn ? (
            <View style={{ gap: space.md, marginBottom: space.lg }}>
              <BarcodeScanner onCode={onCameraCode} />
              <ChunkyButton label="Stop camera" icon="camera-off" outline onPress={() => setCameraOn(false)} />
            </View>
          ) : (
            <View style={{ marginBottom: space.lg }}>
              {!showResult ? (
                <View style={{ marginBottom: space.lg }}>
                  <ScanFrame hint={hasCamera ? "Hold the barcode inside the frame" : "No camera here: type the number below"}>
                    <MaterialCommunityIcons name="barcode-scan" size={72} color={c.accent} accessibilityElementsHidden />
                  </ScanFrame>
                </View>
              ) : null}
              {hasCamera ? (
                <ChunkyButton
                  label="Scan with camera"
                  icon="barcode-scan"
                  disabled={busy}
                  onPress={() => {
                    gate.reset();
                    setCameraOn(true);
                  }}
                />
              ) : null}
            </View>
          )}

          <Panel>
            <TextInput
              label="Or type the barcode number"
              value={manual}
              onChangeText={(t) => {
                setManual(t);
                setInputError(null);
              }}
              keyboardType="number-pad"
              maxLength={20}
              returnKeyType="search"
              onSubmitEditing={submitManual}
              error={!!inputError}
              placeholder="e.g. 4006381333931"
            />
            {inputError ? <HelperText type="error" visible>{inputError}</HelperText> : null}
            <View style={{ marginTop: space.md }}>
              <ChunkyButton
                label={busy ? "Looking up…" : "Look up price"}
                icon="magnify"
                tone="blue"
                onPress={submitManual}
                disabled={busy || manual.trim() === ""}
              />
            </View>
          </Panel>

          {busy ? <SkeletonCards count={1} label="Looking up the price" /> : null}
          {error ? (
            <Panel tone="bad">
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                <MaterialCommunityIcons name="alert-circle-outline" size={24} color={c.bad} />
                <View style={{ flex: 1 }}>
                  <Text variant="titleSmall">That did not work</Text>
                  <Text variant="bodyMedium" style={{ marginTop: 2 }}>{error}</Text>
                </View>
              </View>
            </Panel>
          ) : null}
          {showResult ? <ResultCard r={result} onAdd={addToUsual} usualMessage={usualMessage} /> : null}
        </ScrollView>
      )}
    </Screen>
  );
}

function ResultCard({ r, onAdd, usualMessage }: { r: EanLookup; onAdd: (item: string) => void; usualMessage: string | null }) {
  const p = usePalette();
  const tones = useTones();
  const rows = chainRows(r);
  const head = headline(r);
  const good = head.kind === "cheapest" || head.kind === "only";
  const tone = good ? tones.good : tones.accent;
  return (
    <View>
      <SectionLabel>Result</SectionLabel>
      <Panel>
        <Text variant="titleLarge" style={{ fontWeight: "800" }}>{productTitle(r)}</Text>
        <Text variant="bodySmall" style={{ color: p.muted, marginTop: 2, fontVariant: ["tabular-nums"] }}>EAN {r.ean}</Text>

        <View
          accessibilityRole="summary"
          style={{
            marginTop: space.md,
            padding: space.md,
            borderRadius: 16,
            backgroundColor: tone.bg,
            borderWidth: 2,
            borderColor: tone.border,
            flexDirection: "row",
            alignItems: "center",
            gap: space.md,
          }}
        >
          <MaterialCommunityIcons name={good ? "trophy-outline" : "information-outline"} size={28} color={tone.fg} />
          <RNText style={{ flex: 1, color: tone.fg, fontSize: 16, fontWeight: "800" }}>{head.text}</RNText>
        </View>

        {rows.length > 0 ? (
          <View style={{ gap: space.sm, marginTop: space.md }}>
            {rows.map((row) => (
              <ChainPriceRow
                key={row.key}
                chain={row.chain}
                detail={row.detail}
                priceText={row.main}
                isCheapest={row.isCheapest || row.isTied}
                isOffer={row.isOffer}
                accessibilityLabel={`${row.name} ${row.main}${row.isCheapest ? ", cheapest" : ""}${row.isTied ? ", tied for cheapest" : ""}`}
              />
            ))}
          </View>
        ) : null}

        {r.notes.map((n, i) => (
          <View key={i} style={{ flexDirection: "row", gap: space.sm, marginTop: space.md }}>
            <MaterialCommunityIcons name="information-outline" size={16} color={p.muted} style={{ marginTop: 2 }} />
            <Text variant="bodySmall" style={{ color: p.muted, flex: 1 }}>{n}</Text>
          </View>
        ))}

        {r.item ? (
          <View style={{ marginTop: space.lg }}>
            <ChunkyButton
              label={`Add ${r.item_name ?? "item"} to usual items`}
              icon="plus-circle-outline"
              outline
              onPress={() => onAdd(r.item as string)}
            />
            {usualMessage ? <HelperText type="info" visible>{usualMessage}</HelperText> : null}
          </View>
        ) : null}
      </Panel>

      {r.observations.length > 0 ? (
        <>
          <SectionLabel>Seen by others (Open Prices)</SectionLabel>
          <Group>
            {r.observations.slice(0, 5).map((o, i) => (
              <View key={i} style={{ paddingVertical: space.md, paddingHorizontal: space.lg }}>
                <Text variant="bodyMedium" style={{ fontVariant: ["tabular-nums"] }}>{observationLine(o)}</Text>
              </View>
            ))}
          </Group>
        </>
      ) : null}
    </View>
  );
}
