import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

import type { EanLookup } from "@/api/client";
import { useApi } from "@/api/config";
import { BarcodeScanner, cameraAvailable } from "@/components/BarcodeScanner";
import { Chip, HelperText, List, Text, TextInput } from "@/components/kit";
import { Body, Button, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { tap } from "@/native/haptics";
import { ScanGate, chainRows, checkEan, headline, observationLine, planAddToUsual, productTitle } from "@/scan";

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

  return (
    <Screen>
      <Title>Scan a product</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          <Card>
            {cameraAvailable() ? (
              cameraOn ? (
                <View style={{ gap: 12 }}>
                  <BarcodeScanner onCode={onCameraCode} />
                  <Button label="Stop camera" icon="camera-off" mode="outlined" onPress={() => setCameraOn(false)} />
                </View>
              ) : (
                <Button
                  label="Scan with camera"
                  icon="barcode-scan"
                  onPress={() => {
                    gate.reset();
                    setCameraOn(true);
                  }}
                  disabled={busy}
                />
              )
            ) : (
              <Text variant="bodyMedium" style={{ color: c.muted }}>
                The camera is not available here. Type the number under the barcode instead.
              </Text>
            )}
            <View style={{ marginTop: 16 }}>
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
              <View style={{ marginTop: 8 }}>
                <Button label={busy ? "Looking up…" : "Look up price"} icon="magnify" mode="contained-tonal" onPress={submitManual} disabled={busy || manual.trim() === ""} />
              </View>
            </View>
          </Card>

          {busy ? <Loading /> : null}
          {error ? (
            <Card>
              <Body bold>That did not work</Body>
              <Text variant="bodyMedium" style={{ color: c.bad, marginTop: 4 }}>{error}</Text>
            </Card>
          ) : null}
          {result && !busy ? <ResultCard r={result} onAdd={addToUsual} usualMessage={usualMessage} /> : null}
        </ScrollView>
      )}
    </Screen>
  );
}

function ResultCard({ r, onAdd, usualMessage }: { r: EanLookup; onAdd: (item: string) => void; usualMessage: string | null }) {
  const c = useColors();
  const rows = chainRows(r);
  const head = headline(r);
  const good = head.kind === "cheapest" || head.kind === "only";
  return (
    <Card>
      <Text variant="titleMedium">{productTitle(r)}</Text>
      <Text variant="bodySmall" style={{ color: c.muted }}>{r.ean}</Text>

      <View
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 16,
          borderWidth: 2,
          borderColor: good ? c.good : c.border,
        }}
        accessibilityRole="summary"
      >
        <Body bold>{head.text}</Body>
      </View>

      {rows.map((row) => (
        <List.Item
          key={row.key}
          title={`${row.name} · ${row.main}`}
          description={row.detail}
          left={() => <List.Icon icon={row.isCheapest ? "star" : "store-outline"} color={row.isCheapest ? c.good : undefined} />}
          right={() => (row.isOffer ? <Chip compact>Offer</Chip> : null)}
          accessibilityLabel={`${row.name} ${row.main}${row.isCheapest ? ", cheapest" : ""}${row.isTied ? ", tied for cheapest" : ""}`}
        />
      ))}

      {r.observations.length > 0 ? (
        <View style={{ marginTop: 12 }}>
          <Text variant="titleSmall">Recent prices seen by others (Open Prices)</Text>
          {r.observations.slice(0, 5).map((o, i) => (
            <Text key={i} variant="bodySmall" style={{ color: c.muted, marginTop: 2 }}>{observationLine(o)}</Text>
          ))}
        </View>
      ) : null}

      {r.notes.map((n, i) => (
        <Text key={i} variant="bodySmall" style={{ color: c.muted, marginTop: 8 }}>{n}</Text>
      ))}

      {r.item ? (
        <View style={{ marginTop: 12 }}>
          <Button label={`Add ${r.item_name ?? "item"} to usual items`} icon="plus-circle-outline" mode="outlined" onPress={() => onAdd(r.item as string)} />
          {usualMessage ? <HelperText type="info" visible>{usualMessage}</HelperText> : null}
        </View>
      ) : null}
    </Card>
  );
}
