import { useEffect, useState } from "react";

import { Badge, Banner, Card, ComparisonTable, EmptyState, Row, Screen, Stack, Text, TopBar } from "@financer/ui";

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
  const [images, setImages] = useState<Record<string, string | null>>({});

  useEffect(() => {
    client?.profiles().then((all) => setProfile(all.find((x) => x.name === "default")?.profile)).finally(() => setProfileLoaded(true));
  }, [client]);
  useEffect(() => {
    if (!client || !profileLoaded) return;
    client.compare(ids, profile).then(setCmp).catch((e) => setError(e instanceof ShopApiError ? e.message : "Could not compare."));
  }, [client, ids, profile, profileLoaded]);

  // the comparison itself carries no pictures: fetch each product's (a missing one just shows the placeholder)
  useEffect(() => {
    if (!client) return;
    let alive = true;
    Promise.all(ids.map((id) => client.product(id).then((d) => [id, d.product.image ?? null] as const).catch(() => [id, null] as const))).then((pairs) => {
      if (alive) setImages(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, [client, ids]);

  const header = <TopBar title="Compare" subtitle={`${ids.length} products`} onBack={nav.pop} />;
  if (!cmp) {
    return (
      <Screen header={header}>
        {error ? <Banner tone="danger">{error}</Banner> : <EmptyState icon="timer-sand" title="Comparing…" />}
      </Screen>
    );
  }
  const view = compareView(cmp, images);
  const winner = cmp.columns.find((c) => c.product_id === cmp.winner);
  return (
    <Screen header={header} fixed>
      {winner ? (
        <Card gap="sm">
          <Row><Badge label="Best fit for your weights" tone="accent" icon="check-decagram-outline" /></Row>
          <Text variant="heading">{winner.title}</Text>
        </Card>
      ) : null}
      <Stack grow gap="md">
        <ComparisonTable columns={view.columns} rows={view.rows} />
      </Stack>
    </Screen>
  );
}
