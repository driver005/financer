import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Banner, Box, Button, Card, Group, Icon, ListItem, Row, ScanFrame, Section, Text, TextField, Note } from "@financer/ui";

import type { EanLookup } from "@/api/client";
import { useApi } from "@/api/config";
import { BarcodeScanner, cameraAvailable } from "@/components/BarcodeScanner";
import { ChainPriceRow } from "@/components/grocery/ChainPriceRow";
import { Page } from "@/components/Page";
import { Loading, NeedsSetup } from "@/components/Status";
import { tap } from "@/native/haptics";
import { ScanGate, chainRows, checkEan, headline, observationLine, planAddToUsual, productTitle } from "@/scan";

export default function Scan() {
  const { api, loaded } = useApi();
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

  if (!loaded) return <Page title="Scan a product"><Loading /></Page>;
  if (!api) return <Page title="Scan a product"><NeedsSetup /></Page>;

  const hasCamera = cameraAvailable();
  const showResult = result && !busy;

  return (
    <Page title="Scan a product" subtitle="See which chain sells it cheapest.">
      {hasCamera && cameraOn ? (
        <Box gap="md">
          <BarcodeScanner onCode={onCameraCode} />
          <Button label="Stop camera" icon="camera-off" variant="outline" onPress={() => setCameraOn(false)} />
        </Box>
      ) : (
        <Box gap="lg">
          {!showResult ? (
            <ScanFrame hint={hasCamera ? "Hold the barcode inside the frame" : "No camera here: type the number below"}>
              <Icon name="barcode-scan" size="xl" tone="accent" />
            </ScanFrame>
          ) : null}
          {hasCamera ? (
            <Button
              label="Scan with camera"
              icon="barcode-scan"
              disabled={busy}
              onPress={() => {
                gate.reset();
                setCameraOn(true);
              }}
            />
          ) : null}
        </Box>
      )}

      <Card gap="md">
        <TextField
          label="Or type the barcode number"
          value={manual}
          onChangeText={(t) => {
            setManual(t);
            setInputError(null);
          }}
          keyboardType="number-pad"
          maxLength={20}
          returnKeyType="search"
          onSubmit={submitManual}
          error={inputError ?? undefined}
          placeholder="e.g. 4006381333931"
        />
        <Button label={busy ? "Looking up…" : "Look up price"} icon="magnify" onPress={submitManual} disabled={busy || manual.trim() === ""} />
      </Card>

      {busy ? <Loading rows={1} /> : null}
      {error ? <Banner tone="danger" title="That did not work">{error}</Banner> : null}
      {showResult ? <ResultCard r={result} onAdd={addToUsual} usualMessage={usualMessage} /> : null}
    </Page>
  );
}

function ResultCard({ r, onAdd, usualMessage }: { r: EanLookup; onAdd: (item: string) => void; usualMessage: string | null }) {
  const rows = chainRows(r);
  const head = headline(r);
  const good = head.kind === "cheapest" || head.kind === "only";
  return (
    <Box gap="lg">
      <Section title="Result">
        <Card gap="md">
          <Box gap="2xs">
            <Text variant="heading" level={3}>{productTitle(r)}</Text>
            <Text variant="caption" tone="muted">{`EAN ${r.ean}`}</Text>
          </Box>

          <Row bg={good ? "success-soft" : "accent-soft"} radius="2xl" p="md" gap="md" accessibilityRole="summary">
            <Icon name={good ? "trophy-outline" : "information-outline"} size="xl" tone={good ? "on-success-soft" : "on-accent-soft"} />
            <Box grow><Text variant="bodyStrong" tone={good ? "on-success-soft" : "on-accent-soft"}>{head.text}</Text></Box>
          </Row>

          {rows.length > 0 ? (
            <Box gap="sm">
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
            </Box>
          ) : null}

          {r.notes.map((n, i) => (
            <Note key={i}>{n}</Note>
          ))}

          {r.item ? (
            <Box gap="sm">
              <Button label={`Add ${r.item_name ?? "item"} to usual items`} icon="plus-circle-outline" variant="outline" onPress={() => onAdd(r.item as string)} />
              {usualMessage ? <Note>{usualMessage}</Note> : null}
            </Box>
          ) : null}
        </Card>
      </Section>

      {r.observations.length > 0 ? (
        <Section title="Seen by others (Open Prices)">
          <Group>
            {r.observations.slice(0, 5).map((o, i) => (
              <ListItem key={i} title={observationLine(o)} />
            ))}
          </Group>
        </Section>
      ) : null}
    </Box>
  );
}
