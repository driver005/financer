import { useEffect, useState } from "react";

import { Banner, Card, ComparisonTable, EmptyState, Screen, Stack, Text, TopBar } from "@financer/ui";

import { ShopApiError } from "../../api/client";
import type { Comparison, Profile } from "../../api/types";
import { compareView } from "../../logic/view";
import { useNav } from "../nav";
import { useShop } from "../runtime";

export function CompareScreen({ ids }: { ids: string[] }) {
  const { client } = useShop();
  const nav = useNav();
  const [cmp, setCmp] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | undefined>();
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    client?.profiles().then((all) => setProfile(all.find((x) => x.name === "default")?.profile)).finally(() => setProfileLoaded(true));
  }, [client]);
  useEffect(() => {
    if (!client || !profileLoaded) return;
    client.compare(ids, profile).then(setCmp).catch((e) => setError(e instanceof ShopApiError ? e.message : "Could not compare."));
  }, [client, ids, profile, profileLoaded]);

  const header = <TopBar title="Compare" subtitle={`${ids.length} products`} onBack={nav.pop} />;
  if (!cmp) {
    return (
      <Screen header={header}>
        {error ? <Banner tone="danger">{error}</Banner> : <EmptyState icon="timer-sand" title="Comparing…" />}
      </Screen>
    );
  }
  const view = compareView(cmp);
  const winner = cmp.columns.find((c) => c.product_id === cmp.winner);
  return (
    <Screen header={header} fixed>
      {winner ? (
        <Card tone="accent" gap="xs">
          <Text variant="caption" tone="on-accent-soft">Best fit for your weights</Text>
          <Text variant="heading" tone="on-accent-soft">{winner.title}</Text>
        </Card>
      ) : null}
      <Stack grow gap="md">
        <ComparisonTable columns={view.columns} rows={view.rows} />
      </Stack>
    </Screen>
  );
}
