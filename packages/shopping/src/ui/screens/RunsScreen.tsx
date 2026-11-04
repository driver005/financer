import { useCallback, useEffect, useState } from "react";

import { Badge, Banner, Box, Button, Card, EmptyState, Meter, Row, Screen, Stack, Text, TopBar } from "@financer/ui";

import { ShopApiError } from "../../api/client";
import type { JobView } from "../../api/types";
import { ago } from "../../logic/format";
import { isActive, orderRuns, PHASE_WORDS, phaseTone, runProblems, runSummary } from "../../logic/runs";
import { useNav } from "../nav";
import { useShop } from "../runtime";

/** How often a run that is going is looked at again. */
const WATCH_MS = 3000;

/** The history of reading runs: what each search read, what it found, and which shops had trouble. */
export function RunsScreen() {
  const { client } = useShop();
  const nav = useNav();
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Math.floor(Date.now() / 1000);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setJobs(orderRuns(await client.indexJobs()));
      setError(null);
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "Could not load the runs.");
    }
  }, [client]);
  useEffect(() => void load(), [load]);

  const active = jobs?.some(isActive) ?? false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void load(), WATCH_MS);
    return () => clearInterval(timer);
  }, [active, load]);

  return (
    <Screen maxW="normal" header={<TopBar title="Reading history" subtitle="What each search read" onBack={nav.pop} />}>
      {error ? <Banner tone="danger" action={<Button label="Try again" variant="outline" tone="neutral" size="sm" onPress={() => void load()} />}>{error}</Banner> : null}
      {jobs !== null && jobs.length === 0 ? (
        <EmptyState icon="history" title="Nothing read yet" message="When you search, the shops are read and the run is listed here." />
      ) : (
        <Stack gap="sm">
          {(jobs ?? []).map((j) => {
            const problems = runProblems(j);
            return (
              <Card key={j.id} variant="flat" gap="xs">
                <Row justify="between" gap="sm" align="start">
                  <Box grow><Text variant="bodyStrong">{j.query || "All shops"}</Text></Box>
                  <Badge label={PHASE_WORDS[j.progress.phase]} tone={phaseTone(j.progress.phase)} />
                </Row>
                <Text variant="label" tone="muted">{runSummary(j)}</Text>
                {isActive(j) ? <Meter value={j.progress.percent / 100} label={`${Math.round(j.progress.percent)} percent read`} /> : null}
                <Row justify="between" gap="sm">
                  <Text variant="caption" tone="subtle">{`${j.category ? `${j.category.replace(/_/g, " ")} · ` : ""}${ago(j.started_at, now)}`}</Text>
                  {isActive(j) ? <Button label="Stop" size="sm" variant="ghost" tone="danger" onPress={async () => { await client?.cancelIndex(j.id).catch(() => undefined); await load(); }} /> : null}
                </Row>
                {problems.map((p) => <Text key={p.shop} variant="caption" tone="warning">{`${p.shop}: ${p.text}`}</Text>)}
              </Card>
            );
          })}
        </Stack>
      )}
    </Screen>
  );
}
