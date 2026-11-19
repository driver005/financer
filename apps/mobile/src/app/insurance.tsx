import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  AsyncBoundary, Box, Button, Card, FadeIn, FgHeaderIcon, FgMerchantRow, FgScreen,
  FgSection, Sheet, Text, TextField,
} from "@finance/ui";
import { addPolicy, loadInsurance } from "../lib/finanzguru";
import { fgEuro } from "@finance/ui";
import { parseEuro } from "../lib/money";

type Insurance = Awaited<ReturnType<typeof loadInsurance>>;

export default function InsuranceScreen() {
  const router = useRouter();
  const [data, setData] = useState<Insurance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheetArea, setSheetArea] = useState<string | null>(null);
  const [amount, setAmount] = useState("");

  const load = () => {
    setLoading(true);
    void loadInsurance()
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load your policies"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const covered = data?.coverage.filter((c) => c.covered).length ?? 0;
  const total = data?.coverage.length ?? 0;
  const area = data?.coverage.find((c) => c.key === sheetArea);

  const save = async () => {
    const cents = parseEuro(amount);
    if (!sheetArea || cents === null) return;
    await addPolicy(sheetArea, cents);
    setSheetArea(null); setAmount(""); load();
  };

  return (
    <FgScreen
      title="Insurance"
      actions={<FgHeaderIcon name="comment-question-outline" label="Advice" onPress={() => router.push("/ask")} />}
    >
      <AsyncBoundary loading={loading} error={error} onRetry={load} rows={5}>
        {data && <>
          <FadeIn>
            <Card>
              <Text variant="caption" color="muted">Your monthly premiums</Text>
              <Text variant="numericHeading">{fgEuro(data.monthlyCents)}</Text>
              <Text variant="body3" color="muted">{`${data.policies.length} policies found in your local records`}</Text>
            </Card>
          </FadeIn>
          <FadeIn delay={60}>
            <FgSection title="Coverage check">
              <Card>
                <Text variant="body3" color="muted">{`${covered} of ${total} areas protected`}</Text>
                {data.coverage.map((item) => (
                  <Box key={item.key} row style={{ justifyContent: "space-between", paddingVertical: 8 }}>
                    <Box row gap={10}>
                      <Text variant="body2">{item.emoji}</Text>
                      <Text variant="body3">{item.label}</Text>
                    </Box>
                    {item.covered
                      ? <Text variant="body4" color="income">Covered ✓</Text>
                      : <Button label="Add" variant="secondary" onPress={() => { setSheetArea(item.key); setAmount(""); }} />}
                  </Box>
                ))}
              </Card>
            </FgSection>
          </FadeIn>
          <FadeIn delay={120}>
            <FgSection title="Your policies">
              <Card>
                {data.policies.length ? data.policies.map((policy) => (
                  <FgMerchantRow key={`${policy.id}-${policy.name}`} emoji={policy.emoji} name={policy.name} category={policy.detail} cents={-policy.cents} />
                )) : <Text variant="body3" color="muted">No insurance policies detected yet. Add a missing area above or record one under Obligations.</Text>}
              </Card>
            </FgSection>
          </FadeIn>
          <FadeIn delay={180}>
            <Card>
              <Text variant="heading5">Personal advice</Text>
              <Text variant="body3" color="muted">Ask the local AI companion about your coverage and premiums. Answers use your own transactions.</Text>
              <Button label="Ask your money" icon="comment-question" onPress={() => router.push("/ask")} />
            </Card>
          </FadeIn>
        </>}
      </AsyncBoundary>

      <Sheet visible={!!sheetArea} onClose={() => setSheetArea(null)} title={area?.label ?? "Add policy"}>
        <Text variant="body3" color="muted">Add a monthly premium. Stored locally as a recurring entry.</Text>
        <TextField label="Monthly premium" value={amount} onChangeText={setAmount} numeric placeholder="e.g. 45,90" />
        <Button label="Save policy" onPress={() => void save()} />
      </Sheet>
    </FgScreen>
  );
}
